var async            = require('async');
var _                = require('underscore');
var es               = require('event-stream');
var dos2unix         = require('../lib/dos2unix');
var versionFilter    = require('../lib/streams/versionFilter');
var currencyFilter   = require('../lib/streams/currencyFilter');
var http2raw         = require('../lib/streams/parsers/http2raw');
var jsoner           = require('../lib/streams/jsoner');
var http400          = require('../lib/http/http400');
var parsers          = require('../lib/streams/parsers/doc');
var extractSignature = require('../lib/streams/extractSignature');
var verifySignature  = require('../lib/streams/verifySignature');
var logger           = require('../lib/logger')();
var mlogger          = require('../lib/logger')('membership');
var blockchainDao    = require('../lib/blockchainDao');
var globalValidator  = require('../lib/globalValidator');

module.exports = function (wotServer) {
  return new BlockchainBinding(wotServer);
}

function BlockchainBinding (wotServer) {

  var that = this;
  var conf = wotServer.conf;
  var conn = wotServer.conn;

  // Services
  var http              = wotServer.HTTPService;
  var ParametersService = wotServer.ParametersService;
  var PeeringService    = wotServer.PeeringService;
  var BlockchainService = wotServer.BlockchainService;

  // Models
  var Peer       = wotServer.conn.model('Peer');
  var Membership = wotServer.conn.model('Membership');
  var Identity   = wotServer.conn.model('Identity');

  this.parseMembership = function (req, res) {
    var onError = http400(res);
    http2raw.membership(req, onError)
      .pipe(dos2unix())
      .pipe(parsers.parseMembership(onError))
      .pipe(versionFilter(onError))
      .pipe(currencyFilter(conf.currency, onError))
      // .pipe(extractSignature(onError))
      // .pipe(verifySignature(onError))
      .pipe(wotServer.singleWriteStream(onError))
      .pipe(jsoner())
      .pipe(es.stringify())
      .pipe(res);
  };

  this.parseBlock = function (req, res) {
    var onError = http400(res);
    http2raw.block(req, onError)
      .pipe(dos2unix())
      .pipe(parsers.parseBlock(onError))
      .pipe(versionFilter(onError))
      .pipe(currencyFilter(conf.currency, onError))
      // .pipe(extractSignature(onError))
      // .pipe(verifySignature(onError))
      .pipe(wotServer.singleWriteStream(onError))
      .pipe(jsoner())
      .pipe(es.stringify())
      .pipe(res);
  }

  this.parameters = function (req, res) {
    res.send(200, JSON.stringify({
      "currency": conf.currency,
      "c": conf.c,
      "dt": conf.dt,
      "ud0": conf.ud0,
      "sigDelay": conf.sigDelay,
      "sigValidity": conf.sigValidity,
      "sigQty": conf.sigQty,
      "stepMax": 3, // uCoin only handles 3 step currencies for now
      "powZeroMin": conf.powZeroMin,
      "powPeriod": conf.powPeriod,
      "incDateMin": conf.incDateMin,
      "dtDateMin": conf.dtDateMin
    }, null, "  "));
  };

  this.promoted = function (req, res) {
    async.waterfall([
      function (next){
        ParametersService.getNumber(req, next);
      },
      function (number, next){
        BlockchainService.promoted(number, next);
      }
    ], function (err, promoted) {
      if(err){
        res.send(400, err);
        return;
      }
      res.send(200, JSON.stringify(promoted.json(), null, "  "));
    });
  }

  this.current = function (req, res) {
    async.waterfall([
      function (next){
        BlockchainService.current(next);
      }
    ], function (err, current) {
      res.setHeader("Content-Type", "text/plain");
      if(err || !current){
        res.send(404, err);
        return;
      }
      res.send(200, JSON.stringify(current.json(), null, "  "));
    });
  }

  this.hardship = function (req, res) {
    var member = "";
    var nextBlockNumber = 0;
    async.waterfall([
      function (next){
        ParametersService.getPubkey(req, next);
      },
      function (pubkey, next){
        member = pubkey;
        Identity.isMember(pubkey, next);
      },
      function (isMember, next){
        if (!isMember)
          next('Not a member');
        else
          BlockchainService.current(next);
      },
      function (current, next){
        if (current) {
          nextBlockNumber = current ? current.number + 1 : 0;
        }
        globalValidator(conf, blockchainDao(conn, null)).getTrialLevel(member, next);
      },
    ], function (err, nbZeros) {
      res.setHeader("Content-Type", "text/plain");
      if(err){
        res.send(404, err);
        return;
      }
      res.send(200, JSON.stringify({
        "block": nextBlockNumber,
        "level": nbZeros
      }, null, "  "));
    });
  }
}
