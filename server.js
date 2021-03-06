const SERVER_PORT = 2222;
const DEVICE_PORT = 61408;
const DEVICE_IP = '192.168.1.136';
const DEVICE_SUBNET = '255.255.255.128';
const DEVICE_GATEWAY = '192.168.1.129';

var app = require('koa')();
var router = require('koa-router')();
var logger = require('koa-logger');
var send = require('koa-send');
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

router.get('/', function *(){
  yield send(this, 'index.html');
});

// grab command documentation

var commands = require('./commands.json');

router.get('/commands', function *(){
  this.body = commands;
});

// build a route for each command (and its aliases)

commands.forEach(function(cmd){
  var routes = [cmd.command];

  if(cmd.aliases){
    var aliases = (typeof cmd.aliases == 'string') ? [cmd.aliases] : cmd.aliases;
    routes = routes.concat(aliases);
  }

  routes.forEach(function(route){
    router.get('/' + route, function *(){
      this.body = cmd.input;
    });
  });
});

app
  .use(router.routes())
  .listen(SERVER_PORT);