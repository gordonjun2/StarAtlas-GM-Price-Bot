import { Connection, PublicKey } from '@solana/web3.js';
import { GmClientService, GmEventService, GmEventType, Order } from '@staratlas/factory';
import CoinMarketCap from 'coinmarketcap-api';
import Telegraf from 'telegraf';
import Markup from 'telegraf';
import minimist from 'minimist';
import fs from 'fs';
import axios from 'axios';

// Load in Solana RPC URLs and API keys
var args = minimist(process.argv.slice(2));

var privateInfo;

try {
    privateInfo = JSON.parse(
        fs.readFileSync(`./${args.f || 'private.json'}`, "utf8")
    );
} catch {
    console.log(`The file ${args.f || 'private.json'} has not been found.\nExiting process...`);
    process.exit(0);
}

const rpcURL = privateInfo.rpcURL;
const cmcAPIKey = privateInfo.cmcAPIKey;
const teleAPIKey = privateInfo.teleAPIKey;

// Solana RPC URL Settings
// const connection_mainnet = "https://api.devnet.solana.com";
// const connection_genesysgo = "https://ssc-dao.genesysgo.net/";

var multipleRPC_flag = 0;

if (Array.isArray(rpcURL)) {
    multipleRPC_flag = 1;
    var connections = new Array();
    var rpcURL_temp;
    for (var i = 0; i < rpcURL.length; i++) {
        try {
            rpcURL_temp = new Connection(rpcURL[i]);
            connections.push(rpcURL_temp);
        } catch {
            continue;
        }
    }
    if (connections.length == 0) {
        console.log(`Something is wrong with the RPC URLs provided...\nExiting process...`);
        process.exit(0);
    }
} else {
    try {
        var connection = new Connection(rpcURL);
    } catch {
        console.log(`Something is wrong with the RPC URL provided...\nExiting process...`);
        process.exit(0);
    }
}

// Star Atlas Galactic Marketplace Program ID
const programId = new PublicKey('traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg');

// Star Atlas Galactic Marketplace currencies Settings
const DECIMALS_atlas = 100000000;
const DECIMALS_usdc = 1000000;
const atlasTokenMint = "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx";
const usdcTokenMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Instantiate GmClientService
const gmClientService = new GmClientService();

// CoinMarketCap Settings
try {
    var cmcClient = new CoinMarketCap(cmcAPIKey);
} catch {
    console.log(`Something is wrong with the CoinMarketCap API key provided...\nExiting process...`);
    process.exit(0);
}

const atlasTicker = 'ATLAS';
var atlasData = await cmcClient.getQuotes({symbol: atlasTicker});
atlasData = Object.values(atlasData);
var atlasUSD = atlasData[1][atlasTicker]['quote']['USD']['price'];

// Star Atlas All Assets Information (in .JSON)
var allAssetInformation = await (await fetch("https://galaxy.staratlas.com/nfts")).json();

// Assets to track
const tokenAddress = ['9zrgra3XQkZPt8XNs4fowbqmj7B8bBx76aEmsKSnm9BW', 'HzBx8PP86pyPrrboTHqPYWhxnEB5vXDHDBP8femWfPTS', 'HqPN13pLUVJRiuGSsKjfWZvGKAagK98PshuKu51bnG4E'];            // add tokens to track here
var assetMint = new Array();

// Arrays creation
var assetInformation = new Array();
var assetCheapest_total_USDC_price_current = new Array();
var assetCheapest_total_ATLAS_price_current = new Array();
var tokenAddressLength = tokenAddress.length;

// Runs when Telegram Bot /start and /modify
for (var i = 0; i < tokenAddressLength; i++) {
    assetMint.push(new PublicKey(tokenAddress[i]));
    assetInformation.push(allAssetInformation.filter((nft) => nft.mint === tokenAddress[i]));
    assetCheapest_total_USDC_price_current.push(Infinity);
    assetCheapest_total_ATLAS_price_current.push(Infinity);
}

// Telegram Bot Settings
try {
    var teleBot = new Telegraf(teleAPIKey);
} catch {
    console.log(`Something is wrong with the Telegram Bot API key provided...\nExiting process...`);
    process.exit(0);
}

// Other variables
var assetSellOrder_USDC;
var assetSellOrder_ATLAS;
var assetCheapest_USDC;
var assetCheapest_USDC_price;
var assetCheapest_ATLAS;
var assetCheapest_ATLAS_price;
var assetCheapest_ATLAS_to_USDC_price;
var assetCheapest_total_USDC_price;
var assetCheapest_total_ATLAS_price;
var startTest;
var notificationText_telegram;
var notificationText_console;
var assetMintLength;
var chatID;
var scanManager;
var checkAliveManager;
var globalCounter = 0;
var request;

// Functions
function begin_bot(ctx){
    teleBot.telegram.sendMessage(ctx.chat.id, "Tracking starts now...", { parse_mode: 'HTML' });
    console.log(getDateTime() + ' Timer starts');
    scanManager = setInterval(scan, 30 * 1000);                             // check every 30 sec
    checkAliveManager = setInterval(checkAlive, 6 * 60 * 60 * 1000);        // check every 6 hours
    scan();
}

function getDateTime(){
    let unix_timestamp = Date.now();
    // Create a new JavaScript Date object based on the timestamp
    var date = new Date(unix_timestamp);
    // Hours part from the timestamp
    var hours = date.getHours();
    // Minutes part from the timestamp
    var minutes = "0" + date.getMinutes();
    // Seconds part from the timestamp
    var seconds = "0" + date.getSeconds();
    // Will display time in 10:30:23 format
    var formattedTime = hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);
    let yo = new Date().toISOString()
    var date_str = '[' + yo.substring(0,10) + ' ' + formattedTime + ']';
    return date_str;
}

function checkAlive() {
    teleBot.telegram.sendMessage(chatID, 'Price Tracker is still functioning...', { parse_mode: 'HTML' });
}

function listAssetTracked(ctx) {
    assetMintLength = assetMint.length;
    notificationText_telegram = 'The assets that are currently being tracked:\n\n';
    for (var i = 0; i < assetMintLength; i++) {
        notificationText_telegram = notificationText_telegram + '- <i>' + assetInformation[i][0]['name'] + '</i>\n';
    }
    teleBot.telegram.sendMessage(ctx.chat.id, notificationText_telegram, { parse_mode: 'HTML' });
}

function modifyAssetTrack(ctx) {

    teleBot.telegram.sendMessage(ctx.chat.id, 'Select the options below.', {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "Add asset to track",
                        callback_data: 'add'
                    },
                    {
                        text: "Remove asset from tracking",
                        callback_data: 'remove'
                    },
                    {
                        text: "Exit",
                        callback_data: 'exit'
                    }
                ],

            ]
        }
    })
}

function help(ctx) {

    teleBot.telegram.sendMessage(ctx.chat.id, 'A list of available commands and their description:\n\n' + 
                                              '- <i><u>/start</u></i>: Re-initialise tracking and list assets being tracked\n' +
                                              '- <i><u>/list</u></i>: List assets being tracked\n' +
                                              '- <i><u>/modify</u></i>: Modify assets to be tracked\n' +
                                              '- <i><u>/help</u></i>: To show this message...', { parse_mode: 'HTML' });
}

function addAsset(inputToken) {

}

function removeAsset(inputToken) {
    
}

// get open orders for selected assets in Star Atlas Galactic Marketplace (price in ascending order)
async function scan () {
    globalCounter = globalCounter + 1;

    assetMintLength = assetMint.length;

    try {
        for (var i = 0; i < assetMintLength; i++) {

            assetCheapest_USDC = null;
            assetCheapest_USDC_price = null;
            assetCheapest_ATLAS = null;
            assetCheapest_ATLAS_price = null;
            assetCheapest_ATLAS_to_USDC_price = null;

            if (multipleRPC_flag == 1) {
                connection = connections[globalCounter % connections.length];
            }

            try {
                assetSellOrder_USDC = (await gmClientService.getOpenOrdersForAsset(
                    connection,
                    assetMint[i],
                    programId,
                    )).filter(
                        (order) => order.currencyMint === usdcTokenMint && order.orderType === "sell"
                    ).sort(
                        (a, b) => (a.price.toNumber() / DECIMALS_usdc < b.price.toNumber() / DECIMALS_usdc ? -1 : 1)
                    );
    
                assetSellOrder_ATLAS = (await gmClientService.getOpenOrdersForAsset(
                    connection,
                    assetMint[i],
                    programId,
                    )).filter(
                        (order) => order.currencyMint === atlasTokenMint && order.orderType === "sell"
                    ).sort(
                        (a, b) => (a.price.toNumber() / DECIMALS_atlas < b.price.toNumber() / DECIMALS_atlas ? -1 : 1)
                    );
            } catch {
                if (multipleRPC_flag == 1) {
                    notificationText_console = 'Unable to retrieve data through one of the RPC URLs provided (maybe max request for the RPC URL is reached?)...\nRemoving the RPC URL and skip retrieving...';
                    notificationText_telegram = notificationText_console;

                    console.log(notificationText_console);
                    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
                    connections.splice(globalCounter % connections.length, 1);
                    if (connections.length == 0) {
                        notificationText_console = "Unable to retrieve data through the last RPC URL provided (maybe max request for the RPC URL is reached?)...\nExiting process...";
                        notificationText_telegram = "Unable to retrieve data through the last RPC URL provided (maybe max request for the RPC URL is reached?)...\nStopping the bot...";
                        
                        console.log(notificationText_console);
                        teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
                        process.exit(0);
                    }
                } else {
                    notificationText_console = "Unable to retrieve data through the RPC URL provided (maybe max request for the RPC URL is reached?)...\nExiting process...";
                    notificationText_telegram = "Unable to retrieve data through the RPC URL provided (maybe max request for the RPC URL is reached?)...\nStopping the bot...";

                    console.log(notificationText_console);
                    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
                    process.exit(0);
                }
            }

            if (assetSellOrder_USDC.length > 0){
                assetCheapest_USDC = assetSellOrder_USDC.splice(0, 1);
                assetCheapest_USDC_price = assetCheapest_USDC[0].price.toNumber() / DECIMALS_usdc;
            }

            if (assetSellOrder_ATLAS.length > 0){
                assetCheapest_ATLAS = assetSellOrder_ATLAS.splice(0, 1);
                assetCheapest_ATLAS_price = assetCheapest_ATLAS[0].price.toNumber() / DECIMALS_atlas;
                assetCheapest_ATLAS_to_USDC_price = assetCheapest_ATLAS_price * atlasUSD;
            }

            if (assetCheapest_USDC_price !== null && assetCheapest_ATLAS_to_USDC_price !== null){
                if (assetCheapest_USDC_price <= assetCheapest_ATLAS_to_USDC_price){
                    assetCheapest_total_USDC_price = assetCheapest_USDC_price;
                } else {
                    assetCheapest_total_USDC_price = assetCheapest_ATLAS_to_USDC_price;
                }
                assetCheapest_total_ATLAS_price = assetCheapest_total_USDC_price / atlasUSD;

                if (assetCheapest_total_USDC_price != assetCheapest_total_USDC_price_current[i]){
                    assetCheapest_total_USDC_price_current[i] = assetCheapest_total_USDC_price;
                    assetCheapest_total_ATLAS_price_current[i] = assetCheapest_total_ATLAS_price;

                    notificationText_console = 'The new lowest price for ' + assetInformation[i][0]['name'] + ' is ' + String(assetCheapest_total_USDC_price) + ' USDC / ' + String(assetCheapest_total_ATLAS_price) + ' ATLAS.';
                    notificationText_telegram = 'The new lowest price for <i>' + assetInformation[i][0]['name'] + '</i> is <b>' + String(assetCheapest_total_USDC_price) + ' USDC</b> / <b>' + String(assetCheapest_total_ATLAS_price) + ' ATLAS</b>.';
    
                    console.log(notificationText_console);
                    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
                }

            } else if (assetCheapest_USDC_price !== null && assetCheapest_ATLAS_to_USDC_price == null) {
                assetCheapest_total_USDC_price = assetCheapest_USDC_price;
                assetCheapest_total_ATLAS_price = assetCheapest_total_USDC_price / atlasUSD;

                if (assetCheapest_total_USDC_price != assetCheapest_total_USDC_price_current[i]){
                    assetCheapest_total_USDC_price_current[i] = assetCheapest_total_USDC_price;
                    assetCheapest_total_ATLAS_price_current[i] = assetCheapest_total_ATLAS_price;

                    notificationText_console = 'The new lowest price for ' + assetInformation[i][0]['name'] + ' is ' + String(assetCheapest_total_USDC_price) + ' USDC / ' + String(assetCheapest_total_ATLAS_price) + ' ATLAS.';
                    notificationText_telegram = 'The new lowest price for <i>' + assetInformation[i][0]['name'] + '</i> is <b>' + String(assetCheapest_total_USDC_price) + ' USDC</b> / <b>' + String(assetCheapest_total_ATLAS_price) + ' ATLAS</b>.';
    
                    console.log(notificationText_console);
                    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
                }
            } else if (assetCheapest_USDC_price == null && assetCheapest_ATLAS_to_USDC_price !== null){
                assetCheapest_total_USDC_price = assetCheapest_ATLAS_to_USDC_price;
                assetCheapest_total_ATLAS_price = assetCheapest_total_USDC_price / atlasUSD;

                if (assetCheapest_total_USDC_price != assetCheapest_total_USDC_price_current[i]){
                    assetCheapest_total_USDC_price_current[i] = assetCheapest_total_USDC_price;
                    assetCheapest_total_ATLAS_price_current[i] = assetCheapest_total_ATLAS_price;

                    notificationText_console = 'The new lowest price for ' + assetInformation[i][0]['name'] + ' is ' + String(assetCheapest_total_USDC_price) + ' USDC / ' + String(assetCheapest_total_ATLAS_price) + ' ATLAS.';
                    notificationText_telegram = 'The new lowest price for <i>' + assetInformation[i][0]['name'] + '</i> is <b>' + String(assetCheapest_total_USDC_price) + ' USDC</b> / <b>' + String(assetCheapest_total_ATLAS_price) + ' ATLAS</b>.';
    
                    console.log(notificationText_console);
                    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
                }
            } else {
                assetCheapest_total_USDC_price = Infinity;
                assetCheapest_total_ATLAS_price = Infinity;

                if (assetCheapest_total_USDC_price != assetCheapest_total_USDC_price_current[i]){
                    assetCheapest_total_USDC_price_current[i] = assetCheapest_total_USDC_price;
                    assetCheapest_total_ATLAS_price_current[i] = assetCheapest_total_ATLAS_price;

                    notificationText_console = 'No sell order for ' + assetInformation[i][0]['name'] + '...';
                    notificationText_telegram = 'No sell order for <i>' + assetInformation[i][0]['name'] + '</i>...';

                    console.log(notificationText_console);
                    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' })
                }
            }
        }
    } catch (e) {
        console.log("Error occurred when tracking the price...");
        console.log(e);
        teleBot.telegram.sendMessage(chatID, "Error occurred when tracking the price...", { parse_mode: 'HTML' });
        teleBot.telegram.sendMessage(chatID, e, { parse_mode: 'HTML' });
        process.exit(0);
    }
}

// Entry Point
teleBot.launch();
startTest = "Star Atlas Galactic Marketplace Asset Price Tracker is ready... Type '/start' in the Telegram bot's chat to start."
console.log(startTest);

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Telegram Bot /start
teleBot.start((ctx) => 
    ctx.reply("Hello! I am Star Atlas Galactic Marketplace Asset Price Tracker!\n\nPlease use <i><u>/help</u></i> to see the available commands and their description.", {parse_mode: 'HTML'})
    .then(() => chatID = ctx.chat.id)
    .then(() => listAssetTracked(ctx))
    .then(() => console.log('Tracker has started...'))
    .then(() => console.log('The chat ID in use is ' + String(chatID) + '.'))
    .then(() => begin_bot(ctx))
);

// Telegram Bot /list
teleBot.command('list', ctx => {
    listAssetTracked(ctx)
});

// Telegram Bot /modify
teleBot.command('modify', ctx => {
    modifyAssetTrack(ctx)
});

// Telegram Bot /help
teleBot.command('help', ctx => {
    help(ctx)
});

// Telegram Bot /test
teleBot.command('help', ctx => {
    console.log(ctx.update.message.text);
});

// Telegram Bot action for callback_data 'add' 
teleBot.action('add', async ctx => {
    ctx.deleteMessage();
    teleBot.telegram.sendMessage(chatID, 'Use the command below to add asset to track: \n' +
                                         "add <i>Star Atlas Galactic Marketplace URL or token address of the asset to track</i>.\n\n" +
                                         'eg.\n' +
                                         'add https://play.staratlas.com/market/DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis\n' +
                                         'or\n' +
                                         'add DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis\n\n' +
                                         "To go back to the previous menu, click on the <i><b>Back</b></i> button.\n" +
                                         "To exit, click on the <i><b>Exit</b></i> button.\n", 
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "Back",
                            callback_data: 'back'
                        },
                        {
                            text: "Exit",
                            callback_data: 'exit'
                        }
                    ],

                ]
            }, parse_mode: 'HTML'
        })
    }
)

teleBot.on('message', (ctx) => {
    var messageArray = ctx.message.text.split(' ');
    if (messageArray[0] == 'add') {
        var inputToken = messageArray[1].split('/').slice(-1);
        var checkAsset = allAssetInformation.filter((nft) => nft.mint === inputToken[0]);
        if (checkAsset.length != 0) {
            addAsset(inputToken[0]);
        } else {
            teleBot.telegram.sendMessage(chatID, "No such asset found... Please check the token address again...", { parse_mode: 'HTML' });
        }

    } else if (messageArray[0] == 'remove') {
        var inputToken = messageArray[1].split('/').slice(-1);
        if (assetMint.includes(inputToken[0])) {
            removeAsset(inputToken[0]);
        } else {
            teleBot.telegram.sendMessage(chatID, "This asset is not being tracked... Please check the token address again...", { parse_mode: 'HTML' });
        }
    }
})

// Telegram Bot action for callback_data 'remove' 
teleBot.action('remove', ctx => {
    ctx.deleteMessage();
    teleBot.telegram.sendMessage(chatID, 'Use the command below to remove asset from tracking: \n' +
                                         "remove <i>Star Atlas Galactic Marketplace URL or token address of the asset to track</i>.\n\n" +
                                         'eg.\n' +
                                         'remove https://play.staratlas.com/market/DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis\n' +
                                         'or\n' +
                                         'remove DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis\n\n' +
                                         "To go back to the previous menu, click on the <i><b>Back</b></i> button.\n" +
                                         "To exit, click on the <i><b>Exit</b></i> button.\n", 
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "Back",
                            callback_data: 'back'
                        },
                        {
                            text: "Exit",
                            callback_data: 'exit'
                        }
                    ],

                ]
            }, parse_mode: 'HTML'
        })
    }
)

// Telegram Bot action for callback_data 'exit' 
teleBot.action('exit', ctx => {
    ctx.deleteMessage();
    ctx.reply('No modification made.');

})

// Telegram Bot action for callback_data 'back' 
teleBot.action('back', ctx => {
    ctx.deleteMessage();
    modifyAssetTrack(ctx);
})