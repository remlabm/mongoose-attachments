var mongoose = require('mongoose');
var User = mongoose.model('User');
var plugin = require('../lib/attachments.js');

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
