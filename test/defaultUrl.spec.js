var mongoose = require('mongoose');
var plugin = require('../lib/attachments');
var User = mongoose.model('User');
var checksum = require('checksum');

describe('path', function(){

  it('adds the propertyName in the attached image path', function(done){
    var user = new User({});
    var path = { path: process.cwd() + '/test/fixtures/mongodb.png' };
    user.attach('profile', path, function(err) {
      user.attach('avatar', path, function(err) {
        expect(user.avatar.original.defaultUrl).to.not.eql(user.profile.original.defaultUrl);
        expect(user.avatar.original.defaultUrl).to.include('tmp/avatar/' + user.id + '-original.png');
        expect(user.profile.original.defaultUrl).to.include('tmp/profile/' + user.id + '-original.png');
        done();
      });
    });
  });

});

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
