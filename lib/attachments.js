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

var gmSuper = require('gm');
var ffmpeg = require('fluent-ffmpeg');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var mime = require('mime');
var Promise = require("bluebird");
var existsFn = fs.exists || path.exists;

// keeps a global registry of storage providers
var providersRegistry = {};

var supportedDecodingFormats = [
  'PNG',
  'GIF',
  'TIFF',
  'JPEG',
  'MP4'
];

function findProvider(name) {
  var provider = providersRegistry[name];
  if (!provider) throw new Error('Storage Provider "' + name + '" can not be found');
  return provider;
}

function lookupMediaType(name) {
    return mime.lookup(name);
}

var plugin = function(schema, options) {

  options = options || {};

  if (typeof(options.directory) !== 'string') throw new Error('option "directory" is required');
  if (typeof(options.properties) !== 'object') throw new Error('option "properties" is required');
  if (typeof(options.storage) !== 'object') throw new Error('option "storage" is required');
  _.defaults(options, { idAsDirectory: false, gm: {} });
  _.defaults(options.gm, { imageMagick: true });

  var gm = gmSuper.subClass(options.gm);

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

    if (styleNames.length === 0) {
      throw new Error('property "' + propertyName + '" needs to define at least one style');
    }

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
        dims: { // Dimensions of the Image
          h: Number, // Height
          w: Number // Width
        }
      };

      // Lookup MIME media type from the specified format specified in the model schema
      var mediaType = (styles[styleName].options) ? lookupMediaType(styles[styleName].options.format) : null;

      // Add additional information depending on the file type
      if(mediaType && mediaType.match(/image/i)) {
          _.defaults(propSchema[styleName],
              {
                  depth: Number
              })
      } else if(!mediaType && propertyName === 'videos') {
          _.defaults(propSchema[styleName],
              {
                  duration: Number,
                  bitrate: Number
              })
      }
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
  schema.methods.attach = function(propertyName, attachmentInfo, progress, cb) {

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

        if (!stats.isFile()) {
          return cb(new Error('path to attach from "' + attachmentInfo.path + '" is not a file'));
        }

        Promise.resolve(mime.extension(mime.lookup(attachmentInfo.path)))
        .then(function(format) {
          // First we need to check whether or not the format is supported.
          // If it's not, throw an error
          return supportedDecodingFormats.indexOf(format.toUpperCase()) !== -1;
        })
        .catch(function(err) {
          // Failing here means that the file format is not a supported image.
          // So return false for `canTransform`
          return false;
        })
        .then(function(canTransform) {

          var fileExt = path.extname(attachmentInfo.path);
          var mediaType = lookupMediaType(attachmentInfo.path);
          var styles = propertyOptions.styles || {};

          return Promise.all(_.map(styles, function(style, name) {
            _.defaults(style, {
              options: {},
              transform: function(i) { return i; }
            });

            var useOriginalVideo = mediaType.match(/video/i) && style.options.format === undefined;

            return Promise.resolve({
              image: canTransform && mediaType.match(/image/i) ? style.transform(gm(attachmentInfo.path)) : null,
              video: canTransform && mediaType.match(/video/i) ? style.transform(ffmpeg(attachmentInfo.path)) : null,
              file: useOriginalVideo || !canTransform ? fs.createReadStream(attachmentInfo.path) : null,
              style: style,
              styleName: name,
              attachmentInfo: attachmentInfo,
              fileExt: fileExt
            });
          }));

        })

        .then(function(variants) {

          var index = 0;
          // Now write files to the temporary path.
          // @todo: in the future, this should probably just pass the gm image/stream
          // object to the provider.
          return Promise.all(_.map(variants, function(variant) {
              var styleFileExt = variant.style.options.format ? ('.' + variant.style.options.format) : variant.fileExt;
              var styleFileName = path.basename(variant.attachmentInfo.path, variant.fileExt);
              styleFileName += '-' + variant.styleName + styleFileExt;
              var styleFilePath = path.join(path.dirname(variant.attachmentInfo.path), styleFileName);

              var writeImageToFile = variant.image ? Promise.promisify(gm.prototype.write, variant.image) : null;

              return (function() {
                  if(variant.image) {
                      return writeImageToFile(styleFilePath);

                  // Save video to file when the format option is not defined in the model schema
                  // @todo: allow video conversion
                  } else if(variant.video && variant.style.options.format !== undefined) {
                      return new Promise(function(resolve) {
                          variant.video
                          .on('error', function (err) {
                              console.log('An error occurred: ' + err.message);
                          })
                          .on('end', function () {
                              resolve('end');
                          })
                      })
                  } else if(variant.file || variant.video && variant.style.options.format === undefined) {
                      return new Promise(function(resolve) {
                          variant.file.pipe(fs.createWriteStream(styleFilePath))
                              .on('finish', resolve);
                      });
                  } else {
                      return Promise.resolve();
                  }
              })()
              .catch(function(err) {
                  console.log(err);
              })
              .then(function() {
                progress(Math.floor(100 * index / variants.length));
                index += 1;
                return _.merge(variant, { styleFilePath: styleFilePath });
              });
          }));

        })

        .then(function(variants) {

          // Pass each individual file off to the registered provider
          return Promise.all(_.map(variants, function(variant) {

            var ext = path.extname(variant.styleFilePath);
            var filenameId = options.filenameId ? selfModel[options.filenameId] : selfModel.id;
            var storageStylePath = path.join(
              options.directory,
              propertyName,
              [filenameId, variant.styleName + ext].join(options.idAsDirectory ? '/':'-')
            );

            if (storageStylePath[0] != '/') {
              storageStylePath = '/' + storageStylePath;
            }

            var getFileStats = Promise.promisify(fs.stat);
            var getVideoStats = Promise.promisify(ffmpeg.ffprobe);
            var createOrReplaceFile = Promise.promisify(providerInstance.createOrReplace, providerInstance);

              // Providers expect both stat and identify results for the output image
            return Promise.all([
              getFileStats(variant.styleFilePath),
                (function() {
                    // Get video metadata
                    if(variant.video && variant.style.options.format === undefined) {
                        return getVideoStats(variant.styleFilePath);
                    // Get image metadata
                    } else {
                        return new Promise(function (resolve) {
                            gm(variant.styleFilePath).identify(function(err, value) {
                                return resolve(value);
                            });
                        })
                    }
                })().catch(function(err) { return null; })
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
              return createOrReplaceFile(providerInput);
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

            var features = {};

            // Set additional fields depending on the file type
            if(variant.storageResult.features) {
                // Set image specific information
                if (variant.image || (variant.video && variant.style.options.format !== undefined)) {
                    features = {
                        format: variant.storageResult.features.format,
                        depth: variant.storageResult.features.depth,
                        dims: {
                            h: variant.storageResult.features.size.height,
                            w: variant.storageResult.features.size.width,
                        }
                    };
                // Set video specific information
                } else if (variant.video) {
                    features = {
                        format: variant.storageResult.features.format['format_long_name'],
                        duration: variant.storageResult.features.format['duration'],
                        bitrate: variant.storageResult.features.format['bit_rate'],
                        dims: {
                            h: variant.storageResult.features.streams[0].height,
                            w: variant.storageResult.features.streams[0].width,
                        }
                    };
                }
            }

            _.merge(modelStyle, {
              defaultUrl: variant.storageResult.defaultUrl,
              path: variant.storageResult.path,
              size: variant.storageResult.stats.size,
              mime: variant.storageResult.mime,
              ctime: variant.storageResult.stats.ctime,
              mtime: variant.storageResult.stats.mtime,
              oname: variant.attachmentInfo.name, // original name of the file
            }, features);
          });

          return variants;

        })

        .then(function() { cb(null); })
        .catch(function(err) { return cb(err); })
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

// Export the Plugin for mongoose.js
module.exports = plugin;
