FROM node:18.12.1-slim
MAINTAINER gordonoh@yahoo.com.sg
EXPOSE 8080
ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Singapore

RUN apt-get update && \
    apt-get install -y
ENV USER root
RUN useradd -ms /bin/bash user
COPY main.js /home/user/main.js
COPY package.json /home/user/package.json
COPY package-lock.json /home/user/package-lock.json
COPY private.json /home/user/private.json
COPY docker-start.sh /home/user/docker-start.sh
RUN chmod a+x /home/user/docker-start.sh
USER user
WORKDIR /home/user
RUN npm ci

CMD ["sh","/home/user/docker-start.sh"]