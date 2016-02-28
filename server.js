const SERVER_PORT = 2222;
const DEVICE_PORT = 61408;
const DEVICE_IP = '192.168.1.136';
const DEVICE_SUBNET = '255.255.255.128';
const DEVICE_GATEWAY = '192.168.1.129';

var app = require('koa')();
var router = require('koa-router')();
var logger = require('koa-logger');
var telnet = require('telnet-client');
var connection = new telnet();

app.use(logger());

var channel = {
  exec: function(cmd, cb){
    cb(null, cmd.split(' ')[0] + ' [value]');
  }
};
// var channel = yield connection.connect({
//   host: DEVICE_IP,
//   port: DEVICE_PORT,
//   shellPrompt: '/ # ',
//   timeout: 1500,
//   // removeEcho: 4
// });
console.log(`${DEVICE_IP}:${DEVICE_PORT} connection successful!`);
// console.log(`${DEVICE_IP}:${DEVICE_PORT} connection failed.`);

// function device(cmd, value, cb){
//   console.log(arguments);

//   if(!cb){
//     cb = value;
//     value = '?';
//   }

//   return {};

//   return channel.exec(cmd + ' ' + value, cb);
// };

// grab command documentation

var commands = require('./commands.json');

// build the routes

commands.forEach(function(cmd){
  var routes = (typeof cmd.aliases == 'string') ? [cmd.aliases] : cmd.aliases;
  routes.unshift(cmd.command);

  routes.forEach(function(route){
    router.get('/' + route, function *(){
      this.body = cmd.input;
    });
  });
});

app
  .use(router.routes());

app.listen(SERVER_PORT);