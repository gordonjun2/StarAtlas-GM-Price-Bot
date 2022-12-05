import { Connection, PublicKey } from '@solana/web3.js';
import { GmClientService, GmEventService, GmEventType, Order } from '@staratlas/factory';
import CoinMarketCap from 'coinmarketcap-api';
import Telegraf from 'telegraf';
import Markup from 'telegraf';
import minimist from 'minimist';
import fs from 'fs';
import express from "express";

// To listen at the stated port number (for Google Cloud Run)
var app = express();
app.listen(8080, () => {
 console.log("Listening at port 8080...");
});

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
// const connection_mainnet = "https://api.devnet.solana.com";          // example 1
// const connection_genesysgo = "https://ssc-dao.genesysgo.net/";       // example 2

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
// const tokenAddress = '9zrgra3XQkZPt8XNs4fowbqmj7B8bBx76aEmsKSnm9BW';            // add tokens to track here

// Arrays creation
var assetMint_address = new Array();
var assetMint_key = new Array();
var assetInformation = new Array();
var assetCheapest_total_USDC_price_current = new Array();
var assetCheapest_total_ATLAS_price_current = new Array();

if (Array.isArray(tokenAddress)) {
    var tokenAddressLength = tokenAddress.length;
    for (var i = 0; i < tokenAddressLength; i++) {
        assetMint_address.push(tokenAddress[i]);
        assetMint_key.push(new PublicKey(tokenAddress[i]));
        assetInformation.push(allAssetInformation.filter((nft) => nft.mint === tokenAddress[i]));
        assetCheapest_total_USDC_price_current.push(Infinity);
        assetCheapest_total_ATLAS_price_current.push(Infinity);
    }
} else {
    assetMint_address.push(tokenAddress);
    assetMint_key.push(new PublicKey(tokenAddress));
    assetInformation.push(allAssetInformation.filter((nft) => nft.mint === tokenAddress));
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
var allAssetSellOrder;
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
var addAsset_flag = 0;
var removeAsset_flag = 0;

// Functions
function begin_bot(){
    teleBot.telegram.sendMessage(chatID, "Tracking starts now...", { parse_mode: 'HTML' });
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

function listAssetTracked() {
    assetMintLength = assetMint_address.length;
    notificationText_telegram = 'The assets that are currently being tracked:\n\n';
    for (var i = 0; i < assetMintLength; i++) {
        notificationText_telegram = notificationText_telegram + '- <i>' + assetInformation[i][0]['name'] + '</i>\n';
    }
    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
}

function modifyAssetTrack() {

    teleBot.telegram.sendMessage(chatID, 'Select if you want to add asset to track or remove asset from tracking below.', {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "Add asset",
                        callback_data: 'add'
                    }
                ],
                [
                    {
                        text: "Remove asset",
                        callback_data: 'remove'
                    }
                ],
                [
                    {
                        text: "Exit",
                        callback_data: 'exit'
                    }
                ]

            ]
        }
    })
}

function help() {

    teleBot.telegram.sendMessage(chatID, 'A list of available commands and their description:\n\n' + 
                                              '- <i><u>/start</u></i>: Re-initialise tracking and list assets being tracked\n' +
                                              '- <i><u>/list</u></i>: List assets being tracked\n' +
                                              '- <i><u>/modify</u></i>: Modify assets to be tracked\n' +
                                              '- <i><u>/help</u></i>: To show this message...', { parse_mode: 'HTML' });
}

async function addAsset(inputToken) {
    assetMint_address.push(inputToken);
    assetMint_key.push(new PublicKey(inputToken));
    assetInformation.push(allAssetInformation.filter((nft) => nft.mint === inputToken));
    assetCheapest_total_USDC_price_current.push(Infinity);
    assetCheapest_total_ATLAS_price_current.push(Infinity);

    notificationText_console = assetInformation.slice(-1)[0][0]['name'] + ' is added for tracking...';
    notificationText_telegram = '<i>' + assetInformation.slice(-1)[0][0]['name'] + '</i> is added for tracking...';

    console.log(notificationText_console);
    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
}

async function removeAsset(inputToken) {
    var removeIndex = assetMint_address.indexOf(inputToken);

    notificationText_console = assetInformation[removeIndex][0]['name'] + ' is removed from tracking...';
    notificationText_telegram = '<i>' + assetInformation[removeIndex][0]['name'] + '</i> is removed from tracking...';

    console.log(notificationText_console);
    teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });

    assetMint_address.splice(removeIndex, 1);
    assetMint_key.splice(removeIndex, 1);
    assetInformation.splice(removeIndex, 1);
    assetCheapest_total_USDC_price_current.splice(removeIndex, 1);
    assetCheapest_total_ATLAS_price_current.splice(removeIndex, 1);
}

// get open orders for selected assets in Star Atlas Galactic Marketplace (price in ascending order)
async function scan () {
    globalCounter = globalCounter + 1;

    assetMintLength = assetMint_address.length;

    if (multipleRPC_flag == 1) {
        connection = connections[globalCounter % connections.length];
    }

    try {
        allAssetSellOrder = (await gmClientService.getAllOpenOrders(
            connection,
            programId,
            )).filter(
                (order) => order.orderType === "sell"
            );

        try {
            for (var i = 0; i < assetMintLength; i++) {
    
                assetCheapest_USDC = null;
                assetCheapest_USDC_price = null;
                assetCheapest_ATLAS = null;
                assetCheapest_ATLAS_price = null;
                assetCheapest_ATLAS_to_USDC_price = null;
    
    
                assetSellOrder_USDC = allAssetSellOrder.filter(
                        (order) => order.currencyMint === usdcTokenMint && order.orderMint === assetMint_address[i]
                    ).sort(
                        (a, b) => (a.price.toNumber() / DECIMALS_usdc < b.price.toNumber() / DECIMALS_usdc ? -1 : 1)
                    );
    
                assetSellOrder_ATLAS = allAssetSellOrder.filter(
                    (order) => order.currencyMint === atlasTokenMint && order.orderMint === assetMint_address[i]
                ).sort(
                    (a, b) => (a.price.toNumber() / DECIMALS_atlas < b.price.toNumber() / DECIMALS_atlas ? -1 : 1)
                );
    
    
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

    } catch {
        if (multipleRPC_flag == 1) {
            notificationText_console = 'Unable to retrieve data through one of the RPC URLs provided (maybe max request for the RPC URL is reached?)...\nRemoving the RPC URL and skip retrieving...';
            notificationText_telegram = 'Unable to retrieve data through one of the RPC URLs provided (maybe max request for the RPC URL is reached?)...\n\nRemoving the RPC URL and skip retrieving...';

            console.log(notificationText_console);
            teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
            connections.splice(globalCounter % connections.length, 1);
            if (connections.length == 0) {
                notificationText_console = "Unable to retrieve data through the last RPC URL provided (maybe max request for the RPC URL is reached?)...\nExiting process...";
                notificationText_telegram = "Unable to retrieve data through the last RPC URL provided (maybe max request for the RPC URL is reached?)...\n\nStopping the bot...";
                
                console.log(notificationText_console);
                teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
                process.exit(0);
            }
        } else {
            notificationText_console = "Unable to retrieve data through the RPC URL provided (maybe max request for the RPC URL is reached?)...\nExiting process...";
            notificationText_telegram = "Unable to retrieve data through the RPC URL provided (maybe max request for the RPC URL is reached?)...\n\nStopping the bot...";

            console.log(notificationText_console);
            teleBot.telegram.sendMessage(chatID, notificationText_telegram, { parse_mode: 'HTML' });
            process.exit(0);
        }
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
    .then(() => listAssetTracked())
    .then(() => console.log('Tracker has started...'))
    .then(() => console.log('The chat ID in use is ' + String(chatID) + '.'))
    .then(() => begin_bot())
);

// Telegram Bot /list
teleBot.command('list', ctx => {
    listAssetTracked()
});

// Telegram Bot /modify
teleBot.command('modify', ctx => {
    modifyAssetTrack()
});

// Telegram Bot /help
teleBot.command('help', ctx => {
    help()
});

// Telegram Bot action for callback_data 'add' 
teleBot.action('add', async ctx => {
    ctx.deleteMessage();
    teleBot.telegram.sendMessage(chatID, "Type the Star Atlas Galactic Marketplace URL or token address of the asset to track.\n\n" +
                                         'eg.\n' +
                                         '<i>https://play.staratlas.com/market/DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis</i>\n' +
                                         'or\n' +
                                         '<i>DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis</i>\n\n' +
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
    
        addAsset_flag = 1;

        console.log('Adding asset...')

    }
)

// Telegram Bot action for callback_data 'remove' 
teleBot.action('remove', ctx => {
    ctx.deleteMessage();
    teleBot.telegram.sendMessage(chatID, "Type the Star Atlas Galactic Marketplace URL or token address of the asset to remove from tracking.\n\n" +
                                         'eg.\n' +
                                         '<i>https://play.staratlas.com/market/DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis</i>\n' +
                                         'or\n' +
                                         '<i>DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis</i>\n\n' +
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
        removeAsset_flag = 1;

        console.log('Removing asset...')

    }
)

// Telegram Bot action for callback_data 'exit' 
teleBot.action('exit', ctx => {
    addAsset_flag = 0;
    removeAsset_flag = 0;
    ctx.deleteMessage();
    ctx.reply('No modification made.');
})

// Telegram Bot action for callback_data 'back' 
teleBot.action('back', ctx => {
    addAsset_flag = 0;
    removeAsset_flag = 0;
    ctx.deleteMessage();
    modifyAssetTrack(ctx);
})

// Telegram Bot to execute when there is incoming message by user (used for adding and removing asset only)
teleBot.on('text', (ctx) => {
    if (addAsset_flag == 1) {
        var inputToken = ctx.message.text.split('/').slice(-1);
        if (assetMint_address.includes(inputToken[0])) {
            teleBot.telegram.sendMessage(chatID, "The asset is already being tracked...", { parse_mode: 'HTML' });
        } else {
            var checkAsset = allAssetInformation.filter((nft) => nft.mint === inputToken[0]);
            if (checkAsset.length != 0) {
                addAsset(inputToken[0]);
            } else {
                teleBot.telegram.sendMessage(chatID, "No such asset found... Please check the token address again...", { parse_mode: 'HTML' });
            }
        }
        addAsset_flag = 0;
    } else if (removeAsset_flag == 1) {
        var inputToken = ctx.message.text.split('/').slice(-1);
        if (assetMint_address.includes(inputToken[0])) {
            removeAsset(inputToken[0]);
        } else {
            teleBot.telegram.sendMessage(chatID, "This asset is not being tracked... Please check the token address again...", { parse_mode: 'HTML' });
        }
        removeAsset_flag = 0;
    }
})
