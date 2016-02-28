const SERVER_PORT = 3000;
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

app.use(function *(next){
  this.device = yield connection.connect({
    host: DEVICE_IP,
    port: DEVICE_PORT,
    shellPrompt: '/ # ',
    timeout: 1500,
    // removeEcho: 4
  });
  console.log(`connected to ${DEVICE_IP} on port ${DEVICE_PORT}`);
});

router.get('/version', function *(next){
  var cmd = 'cp750.sysinfo.version';
  var response = yield this.device.exec(cmd);
  this.body = response;
});

app
  .use(router.routes());

app.listen(PORT);