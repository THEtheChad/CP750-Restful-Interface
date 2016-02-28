const SERVER_PORT = 1337;
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
  exec: function(cmd){
    console.log('executing command: ');
    return cmd.split(' ')[0] + '[value]';
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

function device(cmd, value){
  console.log(arguments);
  if(!value) value = '?';

  return channel.exec(cmd + ' ' + value);
};

router
  .get('/', function *(next) {
    this.body = 'Hello World!';
  })
  .get('/version', function *(next){
    // var response = yield device('cp750.sysinfo.version');
    this.body = 'version';
  })
  .get('/marco', function *(next){
    this.body = 'polo';
  });


app
  .use(router.routes());

app.listen(SERVER_PORT);