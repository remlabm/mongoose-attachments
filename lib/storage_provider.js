/* jshint node:true */

'use strict';

// Prototype for Storage Providers
function StorageProvider(options) {
  this.options = options;
}

StorageProvider.prototype.update = function(attachment, cb) {
  throw new Error('method update implemented');
};

module.exports = StorageProvider;
