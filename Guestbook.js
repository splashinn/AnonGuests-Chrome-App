var Guestbook = function() {
  this.channelId = undefined;

  this.registered = false;
  this.verified = false;
  this.listening = false;
  this.creatingWindow = false;
  this.hasWindow = false;
  this.listeners = {};

  this.wantsSubscriptionVerification = false;
};


/**
 * Logs a message string to the console.
 *
 * @this Guestbook
 * @param {string} message The message to log.
 * @param {Object} data Any additional data to log.
 */
Guestbook.prototype.log = function(message, data) {
  if (data) {
    console.log('Guestbook: ' + message, data);
  } else {
    console.log('Guestbook: ' + message);
  }
};

/**
 * Returns a callback bound to the guestbook object.  The
 * callback must be an attribute of the guestbook object.
 *
 * @this Guestbook
 * @param {string} eventName the name of the function to use as a callback.
 * @param {Array} otherArgs any arguments to be bound to the callback.
 *
 * @return {Function} the callback with everything bound.
 */
Guestbook.prototype.cb = function(eventName, otherArgs) {
  var bindArgs = [this];
  if (Object.prototype.toString.call(otherArgs) !== '[object Array]') {
    otherArgs = [];
  }
  var bind = Function.prototype.bind;
  return bind.apply(this[eventName], bindArgs.concat(otherArgs));
};

/**
 * Sets up the Remote Alarm.

 * Activates message listeners and initiates the channel ID request, so that
 * the app will not have to wait to get the channel ID if needed later.
 *
 * @this Guestbook
 */
Guestbook.prototype.initialize = function() {
  this.startListening();

  chrome.pushMessaging.getChannelId(this.cb('onGotChannelId'));
  chrome.app.runtime.onLaunched.addListener(this.cb('onLaunched'));
};

/**
 * Determines if everything required has been done to listen to messages.
 *
 * @this Guestbook
 *
 * @return {Boolean} whether we are ready.
 */
Guestbook.prototype.ready = function() {
  return (typeof this.channelId !== 'undefined') &&
         this.verified &&
         this.registered &&
         this.listening;
};

/**
 * Executed once everything has been done to start receiving messages
 *
 * @this Guestbook
 */
Guestbook.prototype.onReady = function() {
  this.log("Whew! We're ready to roll!");
};

/**
 * Event handler fired when the channel ID has been returned from Chrome.
 *
 * @this Guestbook
 * @param {?Object} message An object containing the channel id.
 */
Guestbook.prototype.onGotChannelId = function(message) {
  // This could be called again on error posting the channel ID to the server.
  if (typeof this.channelId !== 'string') {
    if (!message || !message.channelId) {
      // XXX: retry on error?
      this.log('Channel ID not found. Eek!');
      return;
    }
    console.log('Channel ID discovered. Value: ' + message.channelId);
    this.channelId = message.channelId;
    this.wantsSubscriptionVerification = true;
  }

  this.tellServer({ channelId: this.channelId },
      this.cb('sendChannelIdToServerFailed', [message]));
  if (this.ready() && this.onReady) {
    this.onReady();
  }
};

/**
 * Retries sending the channel id to the server if it fails.
 *
 * @this Guestbook
 * @param {?Object} message An object containing the channel id.
 */
Guestbook.prototype.sendChannelIdToServerFailed = function(message) {
  var ms = 5000;
  var onTimeout = this.cb('onGotChannelId', [message]);
  console.log('Got error sending the channel id. Retrying in ' + ms + ' ms.');
  setTimeout(onTimeout, ms);
};

/**
 * Event handler fired when the push message arrives,
 *  shows it as a text notification (toast)
 *
 * @this Guestbook
 * @param {?Object} message An object containing the message response.
 */
Guestbook.prototype.onMessage = function(message) {
  this.log('Got Message', message);
  if (typeof message.payload === 'string' && message.payload.length == 0) {
    return;
  }

  var routes = {
    0: 'onGuestbookEntry',
    1: 'onSubscriptionVerification'
  };
  var route = routes[message.subchannelId];
  if (route) {
    this.cb(route)(message);
  }
};

/**
 * Changes the displayed message when a push message is received.
 *
 * @this Guestbook
 * @param {Object} message The payload sent from the server.
 */
Guestbook.prototype.onGuestbookEntry = function(message) {
  this.log('Normal message', message);
  this.theLastMessage = message.payload;
  if (this.hasWindow) {
    var win = chrome.app.window.current();
    var doc = win.contentWindow.document;
    var messageContainer = doc.getElementById('last-message');
    messageContainer.innerText = message.payload;
  }
};

/**
 * Receives the verification message and sends it back to the server
 * to confirm our subscription to push messages.
 *
 * @this Guestbook
 * @param {Object} message The payload sent from the server.
 */
Guestbook.prototype.onSubscriptionVerification = function(message) {
  if (this.wantsSubscriptionVerification) {
    this.sendVerificationMessage(message.payload);
  }
};

/**
 * Notifies Chrome to start sending messages to this Guestbook
 *
 * @this Guestbook
 */
Guestbook.prototype.startListening = function() {
  var messager = chrome.pushMessaging;
  this.log('starting to listen');

  this.pushMessageListener = this.cb('onMessage');
  messager.onMessage.addListener(this.pushMessageListener);
  this.listening = true;
  if (this.ready() && this.onReady) {
    this.onReady();
  }
};

/**
 * Notifies Chrome to stop sending messages to this Guestbook
 *
 * @this Guestbook
 */
Guestbook.prototype.stopListening = function() {
  if (this.pushMessageListener) {
    var messager = this.hasPushMessaging();
    if (messager !== false) {
      messager.onMessage.removeListener(this.pushMessageListener);
      this.pushMessageListener = undefined;
    }
  }
};

/**
 * Handles the server response to our subscription request.
 *
 * @this Guestbook
 * @param {Object} xhr The XHR object
 * @param {Function} onerror The event on XHR state change.
 */
Guestbook.prototype.onXHR = function(xhr, onerror) {
  if (xhr.readyState !== 4)
    return;

  if (xhr.status >= 200 && xhr.status <= 300) {
    this.log('Got a 2xx response');
    this.log(xhr.responseText);

    this.xhrResponse = JSON.parse(xhr.responseText);
    this.theLastMessage = this.xhrResponse.lastMessage;
    if (this.hasWindow) {
      var win = chrome.app.window.current();
      var doc = win.contentWindow.document;
      var messageContainer = doc.getElementById('last-message');
      messageContainer.innerText = this.theLastMessage;
    }

    this.registered = true;
    if (this.ready() && this.onReady) {
      this.onReady();
    }
  } else {
    this.log('Unknown response.');
    if (onerror && typeof(onerror) == 'function')
      onerror(xhr);
  }
};

/**
 * Retries the verification message if there is an error.
 *
 * @this Guestbook
 * @param {String} verifier The code that will tell the server we can receive
 *                 messages for this channel ID.
 */
Guestbook.prototype.onVerificationError = function(verifier) {
  this.verified = false;
  var ms = 5000;
  console.log('Got verification error. Retrying in ' + ms + ' ms.');
  setTimeout(function() { this.sendVerificationMessage(verifier); }, ms);
};

/**
 * Dispatches the verification message to the server.
 *
 * @this Guestbook
 * @param {String} verifier The code that will tell the server we can receive
 *                 messages for this channel ID.
 */
Guestbook.prototype.sendVerificationMessage = function(verifier) {
  this.tellServer({
    channelId: this.channelId,
    verifier: verifier
  }, this.cb('onVerificationError', [verifier]));
  this.verified = true;
};

/**
 * Dispatches a request to a remote application server.
 *
 * The application server *must* know this client's channelId
 * in order to send messages.  In addition, the application server
 * must have posession of the appropriate keys necessary to verify
 * ownership of the packaged app, or message delivery will be rejected.
 *
 * @this Guestbook
 * @param {Object} params The things to tell the server.
 * @param {Function} onerror Callback if there is a problem telling the server.
 */
Guestbook.prototype.tellServer = function(params, onerror) {
  var xhr = new XMLHttpRequest();

  this.log('Notifying the server');
  xhr.open('POST', 'http://localhost:8080/monitor');
  xhr.onreadystatechange = this.cb('onXHR', [xhr, onerror]);
  xhr.send(JSON.stringify(params));
};

/**
 * TODO - application level request to cancel push messages.
 */
Guestbook.prototype.unsubscribe = function() { };

/**
 * Removes the reference to a closed window.
 *
 * @this Guestbook
 */
Guestbook.prototype.onWindowClosed = function() {
  this.hasWindow = false;
};

/**
 * Responds to the app window being created by setting the message and tracking
 * the window object within the guestbook object.
 *
 * @this Guestbook
 * @param {Object} theWindow the window object that was created.
 */
Guestbook.prototype.onWindowCreated = function(theWindow) {
  this.creatingWindow = false;
  this.hasWindow = true;
  var message = this.theLastMessage;
  if (message) {
    var doc = theWindow.contentWindow.document;
    doc.onreadystatechange = function() {
      if (doc.readyState == 'complete') {
        var messageContainer = doc.getElementById('last-message');
        messageContainer.innerText = message;
      }
    };
  }
};

/**
 * Handles the launch event sent by the Chrome runtime.
 *
 * @this Guestbook
 */
Guestbook.prototype.onLaunched = function() {
  console.log('Application launched.');
  var opt = {id: 'last-window'};

  if (this.creatingWindow)
    return;

  if (this.hasWindow) {
    chrome.app.window.current.show();
    return;
  }

  this.creatingWindow = true;
  chrome.app.window.create('last.html', opt, this.cb('onWindowCreated'));
};