/* jshint node:true */

// Copyright (c) 2011-2013 Firebase.co - http://www.firebase.co
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

var im = require('imagemagick');
var gm = require('gm');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var async = require('async');
var existsFn = fs.exists || path.exists;
var Q = require('q');

// keeps a global registry of storage providers
var providersRegistry = {};

var supportedDecodingFormats = [
  'PNG',
  'GIF',
  'TIFF',
  'JPEG'
];

function findProvider(name) {
  var provider = providersRegistry[name];
  if (!provider) throw new Error('Storage Provider "' + name + '" can not be found');
  return provider;
}

function findImageMagickFormats(options, callback) {
  var opts = { read: true };
  if (typeof options === 'function') {
    callback = options;
  } else if (options.read || options.write || options.multi || options.blob ) {
    opts = options;
  } else {
    callback(new Error("Options have to contain one or more of 'read', 'write', 'multi', 'blob'"));
  }
  im.convert(['-list','format'], function(err, stdout, stderr) {
    if (err) return callback(err);
    if (stderr && stderr.search(/\S/) >= 0) return callback(new Error(stderr));
    if (stdout && stdout.search(/\S/) >= 0) {
      // capture groups:
      // 0: all
      // 1: format
      // 2: if '*' = native blob support; if ' ' (whitespace) none. Not set with graphicsmagick - therefore optional in regex
      // 3: module
      // 4: if 'r' = read support; if '-' none
      // 5: if 'w' = write support; if '-' none
      // 6: if '+' = support for multiple images; if '-' none
      // 7: description
      var regex = /^\s*([^\*\s]+)(\*|\s)?\s(\S+)\s+([-r])([-w])([-+])\s+(.*)$/;
      var lines = stdout.split("\n");
      var comps = [];
      var formats = [];
      var i, currentLine;
      for (i in lines) {
        currentLine = lines[i];
        comps = regex.exec(currentLine);
        if (comps) {
          if ((!opts.read  || comps[4] === 'r') &&
              (!opts.write || comps[5] === 'w') &&
              (!opts.multi || comps[6] === '+') &&
              (!opts.blob  || comps[2] === '*')) {
            formats.push(comps[1]);
          }
        }
      }
      return callback(null,formats);
    } else {
      return callback(new Error(
        "No format supports the requested operation(s): " +
        Object.keys(opts).toString() +
        " . Check 'convert -list format'"
      ));
    }
  });
}

var plugin = function(schema, options) {

  options = options || {};

  if (typeof(options.directory) !== 'string') throw new Error('option "directory" is required');
  if (typeof(options.properties) !== 'object') throw new Error('option "properties" is required');
  if (typeof(options.storage) !== 'object') throw new Error('option "storage" is required');
  _.defaults(options, { idAsDirectory: false, gm: {} });
  _.defaults(options.gm, { imageMagick: true });

  var storageOptions = options.storage;
  storageOptions.schema = schema;

  if (typeof(storageOptions.providerName) !== 'string') throw new Error('option "storage.providerName" is required');
  var ProviderPrototype = findProvider(storageOptions.providerName);
  var providerOptions = storageOptions.options || {};
  var providerInstance = new ProviderPrototype(providerOptions);

  if (typeof providerInstance.getUrl !== 'function') {
    throw new Error('Provider ' + storageOptions.providerName + ' does not have a method getUrl');
  }

  if (typeof providerInstance.createOrReplace !== 'function') {
    throw new Error('Provider ' + storageOptions.providerName + ' does not have a method createOrReplace');
  }

  var propertyNames = Object.keys(options.properties);
  propertyNames.forEach(function(propertyName) {

    var propertyOptions = options.properties[propertyName];
    if (!propertyOptions) throw new Error('property "' + propertyName + '" requires an specification');

    var styles = propertyOptions.styles || {};
    var styleNames = Object.keys(styles);

    if (styleNames.length === 0) throw new Error('property "' + propertyName + '" needs to define at least one style');

    var addOp = {};
    var propSchema = addOp[propertyName] = {};

    styleNames.forEach(function(styleName) {
      propSchema[styleName] = {
        size: Number, // Size of the File
        oname: String, // Original name of the file
        mtime: Date,
        ctime: Date,
        path: String, // Storage Path
        defaultUrl: String, // Default (non-secure, most of the time public) Url
        format: String, // Format of the File(provided by identify).
        depth: Number,
        dims: { // Dimensions of the Image
          h: Number, // Height
          w: Number // Width
        }
      };
    });

    // Add the Property
    schema.add(addOp);

  }); // for each property name

  // Finally we set the method 'attach'
  // => propertyName: String. Name of the property to attach the file to.
  // => attachmentInfo: {
  //    path: String(required). Path to the file in the file system.
  //    name: String(optional). Original Name of the file.
  //    mime: String(optional). Mime type of the file.
  // }
  schema.methods.attach = function(propertyName, attachmentInfo, cb) {

    var selfModel = this;
    if (propertyNames.indexOf(propertyName) == -1) return cb(new Error('property "' + propertyName + '" was not registered as an attachment property'));
    var propertyOptions = options.properties[propertyName];
    var styles = propertyOptions.styles || {};

    if (!attachmentInfo || typeof(attachmentInfo) !== 'object') return cb(new Error('attachmentInfo is not valid'));
    if (typeof(attachmentInfo.path) !== 'string') return cb(new Error('attachmentInfo has no valid path'));
    if (!attachmentInfo.name) {
      // No original name provided? We infer it from the path
      attachmentInfo.name = path.basename(attachmentInfo.path);
    }

    existsFn(attachmentInfo.path, function(exists) {

      if (!exists) {
        return cb(new Error('file to attach at path "' + attachmentInfo.path + '" does not exists'));
      }

      fs.stat(attachmentInfo.path, function(err, stats) {
        if (!stats.isFile()) return cb(new Error('path to attach from "' + attachmentInfo.path + '" is not a file'));

        // Build the gm image object. we'll use this to build
        // the destination image.
        var image = gm(attachmentInfo.path).options(options.gm);

        Q.ninvoke(image, 'format')
        .then(function(format) {

          // First we need to check whether or not the format is supported.
          // If it's not, throw an error
          var canTransform = supportedDecodingFormats.indexOf(format) != -1;
          if (!canTransform) { throw new Error('File format: ' + format + ' is not supported.'); }

          var fileExt = path.extname(attachmentInfo.path);
          var styles = propertyOptions.styles || {};

          return Q.all(_.map(styles, function(style, name) {
            _.defaults(style, { options: {} });

            return (
              Q.when(_.isFunction(style.transform) ? style.transform(image) : image)
            ).then(function(image) {
              return {
                image: image,
                style: style,
                styleName: name,
                attachmentInfo: attachmentInfo,
                fileExt: fileExt
              };
            });
          }));

        })
        .then(function(variants) {

          // Now write files to the temporary path.
          // @todo: in the future, this should probably just pass the gm image
          // object to the provider.
          return Q.all(_.map(variants, function(variant) {
              var styleFileExt = variant.style.options.format ? ('.' + variant.style.options.format) : variant.fileExt;
              var styleFileName = path.basename(variant.attachmentInfo.path, variant.fileExt);
              styleFileName += '-' + variant.styleName + styleFileExt;
              var styleFilePath = path.join(path.dirname(variant.attachmentInfo.path), styleFileName);

              return Q.ninvoke(image, 'write', styleFilePath)
              .then(function() {
                return _.merge(variant, { styleFilePath: styleFilePath });
              });
          }));

        })
        .then(function(variants) {

          // Pass each individual file off to the registered provider
          return Q.all(_.map(variants, function(variant) {

            var ext = path.extname(variant.styleFilePath);
            var filenameId = options.filenameId ? selfModel[options.filenameId] : selfModel.id;
            var storageStylePath = path.join(
              options.directory,
              propertyName,
              [filenameId, variant.styleName + ext].join(options.idAsDirectory ? '/':'-')
            );

            // Providers expect both stat and identify results for the output image
            return Q.all([
              Q.ninvoke(fs, 'stat', variant.styleFilePath),
              Q.ninvoke(gm(variant.styleFilePath).options(options.gm), 'identify')
            ])
            .spread(function(stats, atts) {
              return {
                style: {
                  name: variant.styleName,
                  options: variant.style
                },
                filename: variant.styleFilePath,
                stats: stats,
                propertyName: propertyName,
                model: selfModel,
                path: storageStylePath,
                defaultUrl: null, // let the storage assign this
                features: atts
              };
            })
            .then(function(providerInput) {
              return Q.ninvoke(providerInstance, 'createOrReplace', providerInput);
            })
            .then(function(storageResult) {
              return _.merge(variant, {
                storageResult: storageResult,
                propertyName: propertyName
              });
            });

          }));

        })
        .then(function(variants) {

          _.forEach(variants, function(variant) {
            var propModel = selfModel[variant.propertyName];
            var modelStyle = propModel[variant.storageResult.style.name];

            _.merge(modelStyle, {
              defaultUrl: variant.storageResult.defaultUrl,
              path: variant.storageResult.path,
              size: variant.storageResult.stats.size,
              mime: variant.storageResult.mime,
              ctime: variant.storageResult.stats.ctime,
              mtime: variant.storageResult.stats.mtime,
              oname: variant.attachmentInfo.name, // original name of the file
              format: variant.storageResult.features.format,
              depth: variant.storageResult.features.depth,
              dims: {
                h: variant.storageResult.features.size.height,
                w: variant.storageResult.features.size.width,
              }
            });
          });

          return variants;

        })
        .then(function() { cb(null); })
        .fail(function(err) { return cb(err); })
        .done();

      });

    });

  }; // method attach
};

plugin.StorageProvider = require('./storage_provider.js');

// Method to Register Storage Providers
plugin.registerStorageProvider = function(name, provider) {
  if (typeof(name) !== 'string') throw new Error('storage engine name is required');
  if (provider && provider._super == plugin.StorageProvider) throw new Error('provider is not valid. it does not inherits from StorageEngine');
  providersRegistry[name] = provider;
};

plugin.findProvider = findProvider;

// Register a Known Decoding Format(e.g 'PNG')
plugin.registerDecodingFormat = function(name) {
  supportedDecodingFormats.push(name);
};

/*
 * Use this to register all formats for which your local ImageMagick installation supports
 * read operations.
 */
plugin.registerImageMagickDecodingFormats = function() {
  plugin.registerImageMagickFormats({ read: true });
};

/*
 * You can register formats based on certain modes or a combination of those:
 * 'read' : true|false
 * 'write': true|false
 * 'multi': true|false
 * 'blob' : true|false
 * options is optional and defaults to { read: true }. If several modes with value true are given,
 * only formats supporting all of them are included.
 */
plugin.registerImageMagickFormats = function(options, callback) {
  if (!callback) {
    callback = function(error, formats) {
      if (error) throw new Error(error);
      else if (formats && formats.length > 0) {
        supportedDecodingFormats = formats;
      } else {
        throw new Error("No formats supported for decoding!");
      }
    };
  }
  findImageMagickFormats(options, callback);
};

// Export the Plugin for mongoose.js
module.exports = plugin;
