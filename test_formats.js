/* jshint node: true  */

'use strict';

var plugin = require('./lib/attachments.js');

plugin.registerImageMagickDecodingFormats();

plugin.registerImageMagickFormats({ read: true }, function(error, formats) {
  if (error) console.log(error);
  else {
    if (formats.indexOf('DOT') >= 0) {
      throw new Error ('DOT has no blob,read,write,multi support');
    }
    if (formats.indexOf('XPS') < 0) {
      throw new Error ('XPS has read support');
    }
    if (formats.indexOf('UIL') >= 0) {
      throw new Error ('UIL has no read,multi support');
    }
    console.log("read support passed");
  }
});

plugin.registerImageMagickFormats({ write: true }, function(error, formats) {
  if (error) console.log(error);
  else {
    if (formats.indexOf('DOT') >= 0) {
      throw new Error ('DOT has no blob,read,write,multi support');
    }
    if (formats.indexOf('XPS') >= 0) {
      throw new Error ('XPS has no write,multi support');
    }
    if (formats.indexOf('UIL') < 0) {
      throw new Error ('UIL has write support');
    }
    console.log("write support passed");
  }
});

plugin.registerImageMagickFormats({ write: true, blob: true }, function(error, formats) {
  if (error) console.log(error);
  else {
    if (formats.indexOf('DOT') >= 0) {
      throw new Error ('DOT has no blob,read,write,multi support');
    }
    if (formats.indexOf('WMV') >= 0) {
      throw new Error ('XPS has write but no blob support');
    }
    if (formats.indexOf('UIL') < 0) {
      throw new Error ('UIL has write and blob support');
    }
    console.log("write and blob support passed");
  }
});

plugin.registerImageMagickFormats({ read: true, multi: true }, function(error, formats) {
  if (error) console.log(error);
  else {
    if (formats.indexOf('DOT') >= 0) {
      throw new Error ('DOT has no blob,read,write,multi support');
    }
    if (formats.indexOf('XPS') >= 0) {
      throw new Error ('XPS has read but no multi support');
    }
    if (formats.indexOf('UIL') >= 0) {
      throw new Error ('UIL has no read,multi support');
    }
    if (formats.indexOf('X') < 0) {
      throw new Error ('X has read and multi support');
    }
    console.log("read and multi support passed");
  }
});
