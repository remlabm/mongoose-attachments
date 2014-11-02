global.chai = require('chai');
global.expect = chai.expect;

var fs = require('fs');
var mongoose = require('mongoose');
var plugin = require('../lib/attachments');

if (!plugin.providersRegistry.fakeProvider) {

  var fakeProvider = function(){};

  fakeProvider.prototype.getUrl = function(path){
    return path;
  };

  fakeProvider.prototype.createOrReplace = function(attachment, next){
    attachment.defaultUrl = this.getUrl(attachment.path);

    console.log(attachment.filename);
    fs.createReadStream(attachment.filename).pipe(
      fs.createWriteStream(attachment.path)
      .on('finish', function() {
        next(null, attachment);
      })
    );
  };

  plugin.registerStorageProvider('fakeProvider', fakeProvider);

}

if (!mongoose.models.User) {

  UserSchema = new mongoose.Schema({ });

  UserSchema.plugin(plugin, {
    directory: process.cwd() + '/tmp',
    storage: { providerName: 'fakeProvider', options: { } },
    properties: {
      profile: { styles: { original: { } } },
      avatar:  {
        styles: {
          original: { },
          thumbnail: {
            thumbnail: '140x140^',
            gravity: 'center',
          }
        }
      },
    }
  });

  mongoose.model('User', UserSchema);

}

