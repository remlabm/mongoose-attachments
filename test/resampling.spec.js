var mongoose = require('mongoose');
var User = mongoose.model('User');
var plugin = require('../lib/attachments.js');
var checksum = require('checksum');

describe('resampling', function() {

  it('creates a separate image', function(done) {
    var user = new User({});
    var path = { path: process.cwd() + '/test/fixtures/mongodb.png' };
    user.attach('avatar', path, function(err) {
      checksum.file(user.avatar.thumbnail.path, function(err, generated) {
        checksum.file(process.cwd() + '/test/fixtures/mongodb-thumbnail-expected.png', function(err, expected) {
          expect(generated).to.equal(expected);
        });
      });
      done();
    });
  });

});
