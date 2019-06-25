/*eslint no-console: ["error", { allow: ["log", "error"] }] */
/* global window, io, fetch, console, loki */

// Initialize DB
let dbGlobal = new loki('txHistory');
// Store Tangle history
let txHistoryGlobal = {};
// Default amount of TX to poll initially
let txAmountToPollGlobal = 15000;
// Amount if retries to poll history API
let InitialHistoryPollRetriesGlobal = 10;
// Flag to prevent multiple simultanious WebSocket connections
let websocketActiveGlobal = {};
// Flag to determine if history was already fetched from backend successfully.
let historyFetchedFromBackendGlobal = false;

// Lodash functions (begin)
const baseSlice = (array, start, end) => {
  var index = -1,
    length = array.length;

  if (start < 0) {
    start = -start > length ? 0 : length + start;
  }
  end = end > length ? length : end;
  if (end < 0) {
    end += length;
  }
  length = start > end ? 0 : (end - start) >>> 0;
  start >>>= 0;

  var result = Array(length);
  while (++index < length) {
    result[index] = array[index + start];
  }
  return result;
};

const takeRight = (array, n, guard) => {
  var length = array == null ? 0 : array.length;
  if (!length) {
    return [];
  }
  n = guard || n === undefined ? 1 : parseInt(n, 10);
  n = length - n;
  return baseSlice(array, n < 0 ? 0 : n, length);
};
// Lodash functions (end)

// Add collections and indeces to lokiDB
const addCollectionsToTxHistory = options => {
  return new Promise((resolve, reject) => {
    let error = false;
    try {
      txHistoryGlobal[options.host] = dbGlobal.addCollection('txHistory', {
        unique: ['hash'],
        indices: ['address', 'bundle', 'receivedAt']
      });
    } catch (e) {
      error = e;
    } finally {
      if (error) {
        console.log(error);
        reject(error);
      } else {
        resolve();
      }
    }
  });
};

// Determine and construct the URL of the data source
const getUrl = options => {
  if (options && options.host) {
    options.hostProtocol = `${options && options.ssl ? 'https:' : 'http:'}`;
    options.hostUrl = `${options.hostProtocol}//${options.host}`;
  } else {
    options.hostProtocol = window.location.protocol;
    options.host = window.location.hostname;
    options.hostUrl = `${options.hostProtocol}//${options.host}`;
  }
  return options;
};

// Random integer generator
const getRndInteger = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// LokiDB "find" query constructor function
const lokiFind = (params, callback) => {
  let result = [];
  let err = false;
  try {
    result = txHistoryGlobal[params.host]
      .chain()
      .find(params && params.query ? params.query : {})
      .simplesort(params && params.sort ? params.sort : '')
      .data({ removeMeta: true });

    if (params.limit && params.limit > 0) result = takeRight(result, params.limit);
  } catch (e) {
    err = 'Error on lokiJS find() call: ' + e;
  } finally {
    if (callback) callback(err, result);
  }
};

// Fetch recent TX history from local or remote backend
const InitialHistoryPoll = (that, options) => {
  const apiUrl = `${
    options.hostUrl
  }:4433/api/v1/getRecentTransactions?amount=${txAmountToPollGlobal}`;

  fetch(apiUrl, { cache: 'no-cache' })
    .then(fetchedList => fetchedList.json())
    .then(fetchedListJSON => {
      // Store fetched TX history in local DB
      const txList = fetchedListJSON.txHistory ? fetchedListJSON.txHistory : [];
      txHistoryGlobal[options.host].insert(txList);
      // Set flag to signal successfull history fetch
      historyFetchedFromBackendGlobal = true;
    })
    .catch(e => {
      console.error('Error fetching txHistory', e);
      if (InitialHistoryPollRetriesGlobal > 0 && !historyFetchedFromBackendGlobal) {
        window.setTimeout(() => InitialHistoryPoll(that, options), 2500);
        InitialHistoryPollRetriesGlobal--;
      }
    });
};

// Helper function to emit updates to all instances of tangleview
const emitToAllInstances = (txType, tx) => {
  tangleview.allInstances.map(instance => {
    instance.emit(txType, tx);
  });
};

// Update conf and milestone status on local DB
const UpdateTXStatus = (update, updateType, options) => {
  const txHash = update.hash;
  const milestoneType = update.milestone;
  const confirmationTime = update.ctime;

  // Find TX by unique index "hash" (Utilizing LokiJS binary index performance)
  const txToUpdate = txHistoryGlobal[options.host].by('hash', txHash);

  if (txToUpdate) {
    if (updateType === 'Confirmed' || updateType === 'Milestone') {
      txToUpdate.ctime = confirmationTime;
      txToUpdate.confirmed = true;
    }
    if (updateType === 'Milestone') {
      txToUpdate.milestone = milestoneType;
    }
    if (updateType === 'Reattach') {
      txToUpdate.reattached = true;
    }

    txHistoryGlobal[options.host].update(txToUpdate);
  } else {
    console.log(
      `LokiJS: ${
        updateType === 'Milestone' ? 'Milestone' : 'TX'
      } not found in local DB - Hash: ${txHash} | updateType: ${updateType}`
    );
  }
};

// Init Websocket
const InitWebSocket = (that, options) => {
  if (!websocketActiveGlobal[options.host]) {
    websocketActiveGlobal[options.host] = true;

    const webSocketUrl = `${options.hostUrl}:4434`;
    const socket = io.connect(webSocketUrl, {
      secure: options.hostProtocol === 'https:' ? true : false,
      reconnection: false
    });

    socket.on('connect', () => {
      console.log(`Successfully connected to Websocket.. [${options.host}]`);

      socket.on('newTX', newTX => {
        /*
        Set timestamp on Global locally
        newTX.receivedAtms = parseInt(Date.now());
        */

        /*
        .insert(newTX) mutates object newTX.
        As such newTX needs to be "dirty copied" before handling the insert.
        */
        emitToAllInstances('txNew', JSON.parse(JSON.stringify(newTX)));
        try {
          txHistoryGlobal[options.host].insert(newTX);
        } catch (e) {
          console.log(e);
        }
      });
      socket.on('update', update => {
        UpdateTXStatus(update, 'Confirmed', options);
        emitToAllInstances('txConfirmed', update);
      });
      socket.on('updateMilestone', updateMilestone => {
        UpdateTXStatus(updateMilestone, 'Milestone', options);
        emitToAllInstances('milestones', updateMilestone);
      });
      socket.on('updateReattach', updateReattach => {
        UpdateTXStatus(updateReattach, 'Reattach', options);
        emitToAllInstances('txReattaches', updateReattach);
      });

      socket.on('disconnect', reason => {
        console.log(`WebSocket disconnect [${reason}]`);
        websocketActiveGlobal[options.host] = false;
        socket.close();

        window.setTimeout(() => {
          InitWebSocket(that, options);
          console.log('WebSocket reconnecting...');
        }, getRndInteger(100, 1000));
      });

      socket.on('reconnect', attemptNumber => {
        console.log(`WebSocket reconnect [${attemptNumber}]`);
      });

      socket.on('reconnect_error', error => {
        console.log(`WebSocket reconnect_error [${error}]`);
        websocketActiveGlobal[options.host] = false;
        window.setTimeout(() => {
          InitWebSocket(that, options);
        }, getRndInteger(10, 100));
      });

      socket.on('connect_timeout', timeout => {
        console.log(`WebSocket connect_timeout [${timeout}]`);
        websocketActiveGlobal[options.host] = false;
        window.setTimeout(() => {
          InitWebSocket(that, options);
        }, getRndInteger(10, 100));
      });

      socket.on('error', error => {
        console.log(`WebSocket error [${error}]`);
      });

      socket.on('connect_error', error => {
        console.log(`WebSocket connect_error [${error}]`);
        websocketActiveGlobal[options.host] = false;
        window.setTimeout(() => {
          InitWebSocket(that, options);
        }, getRndInteger(10, 100));
      });

      // Ensure socket gets closed before exiting the session
      window.addEventListener('beforeunload', () => {
        socket.close();
      });
    });
  }
};

// Class to instanciate the tangleview object which can be implemented to projects
class tangleview {
  constructor(options) {
    this.events = {};
    // If options not specified by user set empty default
    options = options ? options : {};
    options = getUrl(options);
    this.host = options.host;

    tangleview.allInstances.push(this);

    if (!txHistoryGlobal[options.host]) {
      addCollectionsToTxHistory(options)
        .then(() => {
          InitialHistoryPoll(this, options);
        })
        .catch(err => {
          console.log('addCollectionsToTxHistory error: ', err);
        });
    }

    if (!websocketActiveGlobal[options.host]) {
      InitWebSocket(this, options);
    } else if (websocketActiveGlobal[options.host]) {
      console.log('WebSocket already initialized');
    }
  }

  emit(eventName, data) {
    const event = this.events[eventName];
    if (event) {
      event.forEach(fn => {
        fn.call(null, data);
      });
    }
  }

  on(eventName, fn) {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }

    this.events[eventName].push(fn);
    return () => {
      this.events[eventName] = this.events[eventName].filter(eventFn => fn !== eventFn);
    };
  }

  find(query, queryOption) {
    return new Promise((resolve, reject) => {
      lokiFind(
        {
          query: query,
          limit: queryOption && queryOption.limit ? queryOption.limit : -1,
          sort: queryOption && queryOption.sort ? queryOption.sort : '',
          host: this.host
        },
        (err, res) => {
          if (err) {
            reject(err);
          } else {
            resolve(res);
          }
        }
      );
    });
  }

  remove(query, queryOption) {
    return new Promise((resolve, reject) => {
      let error = false;
      let result;
      try {
        result = txHistoryGlobal[this.host]
          .chain()
          .find(query)
          .limit(queryOption && queryOption.limit ? queryOption.limit : -1)
          .remove();
      } catch (e) {
        error = e;
      } finally {
        if (!error) {
          resolve(result);
        } else {
          reject(error);
        }
      }
    });
  }

  getTxHistory(options) {
    return new Promise((resolve, reject) => {
      let retries = 20;
      console.log(this.host, options);
      const lokiFindWrapper = () => {
        lokiFind(
          {
            limit: options && options.amount ? options.amount : -1,
            host: this.host
          },
          (err, res) => {
            if (err) {
              reject(err);
            } else {
              if (res.length <= 5 && retries > 0 && !historyFetchedFromBackendGlobal) {
                retries--;
                window.setTimeout(() => {
                  lokiFindWrapper();
                }, 100);
              } else if (res.length <= 5 && retries === 0 && !historyFetchedFromBackendGlobal) {
                reject(res);
              } else {
                resolve(res);
              }
            }
          }
        );
      };
      lokiFindWrapper();
    });
  }
}

// Store instances of tangleview (so they can be called simultaniously)
tangleview.allInstances = [];
