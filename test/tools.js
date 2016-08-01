"use strict";

var NODE_JS = (typeof module !== "undefined") && process && !process.browser;

var fs = (NODE_JS) ? require("fs") : null;
var path = (NODE_JS) ? require("path") : null;
var assert = require("chai").assert;
var BigNumber = require("bignumber.js");
var Decimal = require("decimal.js");
var abi = require("augur-abi");
var madlibs = require("madlibs");
var async = require("async");
var chalk = require("chalk");
var clone = require("clone");
var moment = require("moment");
var constants = require("../src/constants");
var reptools = require("../src/modules/reportingTools");

BigNumber.config({MODULO_MODE: BigNumber.EUCLID});

var displayed_connection_info = false;

module.exports = {

    DEBUG: false,

    // maximum number of accounts/samples for testing
    MAX_TEST_ACCOUNTS: 3,
    UNIT_TEST_SAMPLES: 100,
    MAX_TEST_SAMPLES: 10,

    // unit test timeout
    TIMEOUT: 600000,

    // approximately equals threshold
    EPSILON: 1e-6,

    print_residual: function (periodLength, label) {
        var t = parseInt(new Date().getTime() / 1000);
        periodLength = parseInt(periodLength);
        var residual = (t % periodLength) + "/" + periodLength + " (" + reptools.getCurrentPeriodProgress(periodLength) + "%)";
        if (label) console.log("\n" + chalk.blue.bold(label));
        console.log(chalk.white.dim(" - Residual:"), chalk.cyan.dim(residual));
    },

    print_reporting_status: function (augur, eventID, label) {
        var sender = augur.from;
        var branch = augur.Events.getBranch(eventID);
        var periodLength = parseInt(augur.Branches.getPeriodLength(branch));
        var redistributed = augur.ConsensusData.getRepRedistributionDone(branch, sender);
        var votePeriod = augur.Branches.getVotePeriod(branch);
        var lastPeriodPenalized = augur.ConsensusData.getPenalizedUpTo(branch, sender);
        if (label) console.log("\n" + chalk.blue.bold(label));
        console.log(chalk.white.dim(" - Vote period:          "), chalk.blue(votePeriod));
        console.log(chalk.white.dim(" - Expiration period:    "), chalk.blue(Math.floor(augur.getExpiration(eventID) / periodLength)));
        console.log(chalk.white.dim(" - Current period:       "), chalk.blue(reptools.getCurrentPeriod(periodLength)));
        console.log(chalk.white.dim(" - Last period:          "), chalk.blue(votePeriod - 1));
        console.log(chalk.white.dim(" - Last period penalized:"), chalk.blue(lastPeriodPenalized));
        console.log(chalk.white.dim(" - Rep redistribution:   "), chalk.cyan.dim(redistributed));
        this.print_residual(periodLength);
    },

    top_up: function (augur, branch, accounts, password, callback) {
        var unlocked = [];
        var self = this;
        var active = augur.from;
        async.eachSeries(accounts, function (account, nextAccount) {
            augur.rpc.personal("unlockAccount", [account, password], function (res) {
                if (res && res.error) return nextAccount();
                if (self.DEBUG) console.log(chalk.white.dim("Unlocked account:"), chalk.green(account));
                augur.Cash.balance(account, function (cashBalance) {
                    augur.Reporting.getRepBalance({
                        branch: branch,
                        address: account,
                        callback: function (repBalance) {
                            augur.useAccount(account);
                            if (parseFloat(cashBalance) >= 10000000000 && parseFloat(repBalance) >= 47) {
                                unlocked.push(account);
                                return nextAccount();
                            }
                            augur.fundNewAccount({
                                branch: branch,
                                onSent: augur.utils.noop,
                                onSuccess: function (r) {
                                    if (r.callReturn !== "1") return nextAccount();
                                    augur.setCash({
                                        address: account,
                                        balance: "10000000000",
                                        onSent: augur.utils.noop,
                                        onSuccess: function (r) {
                                            if (r.callReturn === "1") unlocked.push(account);
                                            nextAccount();
                                        },
                                        onFailed: function () { nextAccount(); }
                                    });
                                },
                                onFailed: function () { nextAccount(); }
                            });
                        }
                    });
                });
            });
        }, function (err) {
            if (err) return callback(err);
            augur.useAccount(active);
            callback(null, unlocked);
        });
    },

    create_each_market_type: function (augur, branchID, expDate, callback) {
        var self = this;
        function is_created(markets) {
            return markets.scalar && markets.categorical && markets.binary;
        }

        // markets have matching descriptions, tags, fees, etc.
        branchID = branchID || augur.constants.DEFAULT_BRANCH_ID;
        var streetName = madlibs.streetName();
        var action = madlibs.action();
        var city = madlibs.city();
        var description = "Will " + city + " " + madlibs.noun() + " " + action + " " + streetName + " " + madlibs.noun() + "?";
        var resolution = "http://" + action + "." + madlibs.noun() + "." + madlibs.tld();
        var tags = [streetName, action, city];
        var extraInfo = streetName + " is a " + madlibs.adjective() + " " + madlibs.noun() + ".  " + madlibs.transportation() + " " + madlibs.usState() + " " + action + " and " + madlibs.noun() + "!";
        expDate = expDate || parseInt(new Date().getTime() / 995);
        var takerFee = "0.02";
        var makerFee = "0.01";
        var numCategories = 7;
        var categories = new Array(numCategories);
        for (var i = 0; i < numCategories; ++i) {
            categories[i] = madlibs.action();
        }
        var markets = {};

        // create a binary market
        augur.createSingleEventMarket({
            branchId: branchID,
            description: description,
            expDate: expDate,
            minValue: 1,
            maxValue: 2,
            numOutcomes: 2,
            resolution: resolution,
            takerFee: takerFee,
            makerFee: makerFee,
            tags: tags,
            extraInfo: extraInfo,
            onSent: function (res) {
                assert.isNull(res.callReturn);

                // create a categorical market
                augur.createSingleEventMarket({
                    branchId: branchID,
                    description: description + "~|>" + categories.join('|'),
                    expDate: expDate,
                    minValue: 1,
                    maxValue: 2,
                    numOutcomes: numCategories,
                    resolution: resolution,
                    takerFee: takerFee,
                    makerFee: makerFee,
                    tags: tags,
                    extraInfo: extraInfo,
                    onSent: function (res) {
                        assert.isNull(res.callReturn);

                        // create a scalar market
                        augur.createSingleEventMarket({
                            branchId: branchID,
                            description: description,
                            expDate: expDate,
                            minValue: 5,
                            maxValue: 10,
                            numOutcomes: 2,
                            resolution: resolution,
                            takerFee: takerFee,
                            makerFee: makerFee,
                            tags: tags,
                            extraInfo: extraInfo,
                            onSent: function (res) {
                                assert.isNull(res.callReturn);
                            },
                            onSuccess: function (res) {
                                if (self.DEBUG) console.debug("Scalar market ID:", res.callReturn);
                                assert.isNotNull(res.callReturn);
                                markets.scalar = res.callReturn;
                                if (is_created(markets)) callback(null, markets);
                            },
                            onFailed: function (err) {
                                if (self.DEBUG) console.error("createSingleEventMarket failed:", err);
                                callback(new Error(self.pp(err)));
                            }
                        });
                    },
                    onSuccess: function (res) {
                        if (self.DEBUG) console.debug("Categorical market ID:", res.callReturn);
                        assert.isNotNull(res.callReturn);
                        markets.categorical = res.callReturn;
                        if (is_created(markets)) callback(null, markets);
                    },
                    onFailed: function (err) {
                        if (self.DEBUG) console.error("createSingleEventMarket failed:", err);
                        callback(new Error(self.pp(err)));
                    }
                });
            },
            onSuccess: function (res) {
                if (self.DEBUG) console.debug("Binary market ID:", res.callReturn);
                assert.isNotNull(res.callReturn);
                markets.binary = res.callReturn;
                if (is_created(markets)) callback(null, markets);
            },
            onFailed: function (err) {
                if (self.DEBUG) console.error("createSingleEventMarket failed:", err);
                callback(new Error(self.pp(err)));
            }
        });
    },

    trade_in_each_market: function (augur, amountPerMarket, markets, maker, taker, password, callback) {
        var self = this;
        var branch = augur.getBranchID(markets.binary);
        var periodLength = augur.getPeriodLength(branch);
        var active = augur.from;
        async.forEachOf(markets, function (market, type, nextMarket) {
            augur.rpc.personal("unlockAccount", [maker, password], function (unlocked) {
                if (unlocked && unlocked.error) return nextMarket(unlocked);
                augur.useAccount(maker);
                if (self.DEBUG) self.print_residual(periodLength, "[" + type  + "] Buying complete set");
                augur.buyCompleteSets({
                    market: market,
                    amount: amountPerMarket,
                    onSent: function (r) {
                        assert.isNull(r.callReturn);
                    },
                    onSuccess: function (r) {
                        assert.strictEqual(r.callReturn, "1");
                        if (self.DEBUG) self.print_residual(periodLength, "[" + type  + "] Placing sell order");
                        augur.sell({
                            amount: amountPerMarket,
                            price: "0.99",
                            market: market,
                            outcome: 1,
                            onSent: function (r) {
                                assert.isNull(r.callReturn);
                            },
                            onSuccess: function (r) {
                                assert.isNotNull(r.callReturn);
                                nextMarket(null);
                            },
                            onFailed: nextMarket
                        });
                    },
                    onFailed: nextMarket
                });
            });
        }, function (err) {
            assert.isNull(err);
            augur.useAccount(taker);
            var trades = [];
            async.forEachOf(markets, function (market, type, nextMarket) {
                if (self.DEBUG) self.print_residual(periodLength, "[" + type  + "] Searching for trade...");
                var marketTrades = augur.get_trade_ids(market);
                if (!marketTrades || !marketTrades.length) {
                    return nextMarket("no trades found for " + market);
                }
                async.eachSeries(marketTrades, function (thisTrade, nextTrade) {
                    var tradeInfo = augur.get_trade(thisTrade);
                    if (!tradeInfo) return nextTrade("no trade info found");
                    if (tradeInfo.owner === augur.from) return nextTrade(null);
                    if (tradeInfo.type === "buy") return nextTrade(null);
                    if (self.DEBUG) self.print_residual(periodLength, "[" + type  + "] Trading");
                    nextTrade(thisTrade);
                }, function (trade) {
                    assert.isNotNull(trade);
                    trades.push(trade);
                    nextMarket(null);
                });
            }, function (err) {
                if (self.DEBUG) console.log(chalk.white.dim("Trade IDs:"), trades);
                assert.isNull(err);
                assert.strictEqual(trades.length, Object.keys(markets).length);
                augur.rpc.personal("unlockAccount", [taker, password], function (unlocked) {
                    if (unlocked && unlocked.error) return callback(unlocked);
                    augur.trade({
                        max_value: Object.keys(markets).length*amountPerMarket,
                        max_amount: 0,
                        trade_ids: trades,
                        onTradeHash: function (tradeHash) {
                            if (self.DEBUG) {
                                self.print_residual(periodLength, "Trade hash: " + tradeHash);
                            }
                            assert.notProperty(tradeHash, "error");
                            assert.isString(tradeHash);
                        },
                        onCommitSent: function (r) {
                            assert.strictEqual(r.callReturn, "1");
                        },
                        onCommitSuccess: function (r) {
                            if (self.DEBUG) self.print_residual(periodLength, "Trade committed");
                            assert.strictEqual(r.callReturn, "1");
                        },
                        onCommitFailed: callback,
                        onNextBlock: function (block) {
                            if (self.DEBUG) self.print_residual(periodLength, "Got block " + block);
                        },
                        onTradeSent: function (r) {
                            assert.isNull(r.callReturn);
                        },
                        onTradeSuccess: function (r) {
                            if (self.DEBUG) {
                                self.print_residual(periodLength, "Trade complete: " + JSON.stringify(r, null, 2));
                            }
                            assert.isObject(r);
                            assert.notProperty(r, "error");
                            assert.property(r, "unmatchedCash");
                            assert.property(r, "unmatchedShares");
                            augur.useAccount(active);
                            callback(null);
                        },
                        onTradeFailed: callback
                    });
                });
            });
        });
    },

    wait_until_expiration: function (augur, eventID, callback) {
        var periodLength = augur.getPeriodLength(augur.getBranch(eventID));
        var t = parseInt(new Date().getTime() / 1000);
        var currentPeriod = augur.getCurrentPeriod(periodLength);
        var expirationPeriod = Math.floor(augur.getExpiration(eventID) / periodLength);
        var periodsToGo = expirationPeriod - currentPeriod;
        var secondsToGo = periodsToGo*periodLength + periodLength - (t % periodLength);
        if (this.DEBUG) {
            this.print_reporting_status(augur, eventID, "Waiting until period after new events expire...");
            console.log(chalk.white.dim(" - Periods to go:"), chalk.cyan.dim(periodsToGo + " + " + (periodLength - (t % periodLength)) + "/" + periodLength + " (" + (100 - augur.getCurrentPeriodProgress(periodLength)) + "%)"));
            console.log(chalk.white.dim(" - Minutes to go:"), chalk.cyan.dim(secondsToGo / 60));
        }
        setTimeout(function () {
            assert.strictEqual(augur.getCurrentPeriod(periodLength), expirationPeriod + 1);
            callback(null);
        }, secondsToGo*1000);
    },

    chunk32: function (string, stride, offset) {
        var elements, chunked, position;
        if (string.length >= 66) {
            stride = stride || 64;
            if (offset) {
                elements = Math.ceil(string.slice(offset).length / stride) + 1;
            } else {
                elements = Math.ceil(string.length / stride);
            }
            chunked = new Array(elements);
            position = 0;
            for (var i = 0; i < elements; ++i) {
                if (offset && i === 0) {
                    chunked[i] = string.slice(position, position + offset);
                    position += offset;
                } else {
                    chunked[i] = string.slice(position, position + stride);
                    position += stride;
                }
            }
            return chunked;
        } else {
            return string;
        }
    },

    pp: function (obj, indent) {
        var o = clone(obj);
        for (var k in o) {
            if (!o.hasOwnProperty(k)) continue;
            if (o[k] && o[k].constructor === Function) {
                o[k] = o[k].toString();
                if (o[k].length > 64) {
                    o[k] = o[k].match(/function (\w*)/).slice(0, 1).join('');
                }
            }
        }
        return chalk.green(JSON.stringify(o, null, indent || 4));
    },

    print_nodes: function (nodes) {
        var node;
        if (nodes && nodes.length) {
            process.stdout.write(chalk.green.bold("hosted:   "));
            for (var i = 0, len = nodes.length; i < len; ++i) {
                node = nodes[i];
                node = (i === 0) ? chalk.green(node) : chalk.gray(node);
                process.stdout.write(node + ' ');
                if (i === len - 1) process.stdout.write('\n');
            }
        }
    },

    setup: function (augur, args, rpcinfo) {
        var defaulthost, ipcpath, wsUrl;
        if (NODE_JS && process.env.AUGURJS_INTEGRATION_TESTS) {
            defaulthost = "http://127.0.0.1:8545";
            ipcpath = process.env.GETH_IPC;
            wsUrl = "ws://127.0.0.1:8546";
        }
        if (process.env.CONTINUOUS_INTEGRATION) {
            this.TIMEOUT = 131072;
        }
        augur.rpc.retryDroppedTxs = true;
        if (defaulthost) augur.rpc.setLocalNode(defaulthost);
        if (augur.connect({http: rpcinfo || defaulthost, ipc: ipcpath, ws: wsUrl})) {
            if ((!require.main && !displayed_connection_info) || augur.options.debug.connect) {
                console.log(chalk.cyan.bold("local:   "), chalk.cyan(augur.rpc.nodes.local));
                console.log(chalk.blue.bold("ws:      "), chalk.blue(augur.rpc.wsUrl));
                console.log(chalk.magenta.bold("ipc:     "), chalk.magenta(augur.rpc.ipcpath));
                this.print_nodes(augur.rpc.nodes.hosted);
                console.log(chalk.yellow.bold("network: "), chalk.yellow(augur.network_id));
                console.log(chalk.bold("coinbase:"), chalk.white.dim(augur.coinbase));
                console.log(chalk.bold("from:    "), chalk.white.dim(augur.from));
                displayed_connection_info = true;
            }
            augur.nodes = augur.rpc.nodes.hosted;
        }
        return augur;
    },

    reset: function (mod) {
        mod = path.join(__dirname, "..", "src", path.parse(mod).name);
        delete require.cache[require.resolve(mod)];
        return require(mod);
    },

    // calculate date from block number
    block_to_date: function (augur, block) {
        var current_block = augur.rpc.blockNumber();
        var seconds = (block - current_block) * constants.SECONDS_PER_BLOCK;
        var date = moment().add(seconds, 'seconds');
        return date;
    },

    // calculate block number from date
    date_to_block: function (augur, date) {
        date = moment(new Date(date));
        var current_block = augur.rpc.blockNumber();
        var now = moment();
        var seconds_delta = date.diff(now, 'seconds');
        var block_delta = parseInt(seconds_delta / constants.SECONDS_PER_BLOCK);
        return current_block + block_delta;
    },

    get_test_accounts: function (augur, max_accounts) {
        var accounts;
        if (augur) {
            if (typeof augur === "object") {
                accounts = augur.rpc.accounts();
            } else if (typeof augur === "string") {
                accounts = require("fs").readdirSync(require("path").join(augur, "keystore"));
                for (var i = 0, len = accounts.length; i < len; ++i) {
                    accounts[i] = abi.prefix_hex(accounts[i]);
                }
            }
            if (max_accounts && accounts && accounts.length > max_accounts) {
                accounts = accounts.slice(0, max_accounts);
            }
            return accounts;
        }
    },

    wait: function (seconds) {
        var start, delay;
        start = new Date();
        delay = seconds * 1000;
        while ((new Date()) - start <= delay) {}
        return true;
    },

    get_balances: function (augur, account, branch) {
        if (augur) {
            branch = branch || augur.constants.DEFAULT_BRANCH_ID;
            account = account || augur.coinbase;
            return {
                cash: augur.getCashBalance(account),
                reputation: augur.getRepBalance(branch || augur.constants.DEFAULT_BRANCH_ID, account),
                ether: abi.bignum(augur.rpc.balance(account)).dividedBy(constants.ETHER).toFixed()
            };
        }
    },

    copy: function (obj) {
        if (null === obj || "object" !== typeof obj) return obj;
        var copy = obj.constructor();
        for (var attr in obj) {
            if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
        }
        return copy;
    },

    remove_duplicates: function (arr) {
        return arr.filter(function (element, position, array) {
            return array.indexOf(element) === position;
        });
    },

    toDecimal: function (x) {
        if (!x) return null;
        if (x.constructor === Array) {
            for (var i = 0, n = x.length; i < n; ++i) {
                x[i] = this.toDecimal(x[i]);
            }
        } else if (x.constructor !== Decimal) {
            if (x.toFixed && x.toFixed.constructor === Function) {
                x = x.toFixed();
            }
            if (x.toString && x.toString.constructor === Function) {
                x = x.toString();
            }
            x = new Decimal(x);
        }
        return x;
    },

    has_value: function (o, v) {
        for (var p in o) {
            if (o.hasOwnProperty(p)) {
                if (o[p] === v) return p;
            }
        }
    },

    linspace: function (a, b, n) {
        if (typeof n === "undefined") n = Math.max(Math.round(b - a) + 1, 1);
        if (n < 2) return (n === 1) ? [a] : [];
        var i, ret = new Array(n);
        n--;
        for (i = n; i >= 0; i--) {
            ret[i] = (i*b + (n - i)*a) / n;
        }
        return ret;
    },

    select_random: function (arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    fold: function (arr, num_cols) {
        var i, j, folded, num_rows, row;
        folded = [];
        num_cols = parseInt(num_cols);
        num_rows = arr.length / num_cols;
        num_rows = parseInt(num_rows);
        for (i = 0; i < parseInt(num_rows); ++i) {
            row = [];
            for (j = 0; j < num_cols; ++j) {
                row.push(arr[i*num_cols + j]);
            }
            folded.push(row);
        }
        return folded;
    },

    gteq0: function (n) { return (new BigNumber(n)).toNumber() >= 0; },

    print_matrix: function (m) {
        for (var i = 0, rows = m.length; i < rows; ++i) {
            process.stdout.write("\t");
            for (var j = 0, cols = m[0].length; j < cols; ++j) {
                process.stdout.write(chalk.cyan(m[i][j] + "\t"));
            }
            process.stdout.write("\n");
        }
    }

};
