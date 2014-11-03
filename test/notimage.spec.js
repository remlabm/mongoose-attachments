var mongoose = require('mongoose');
var User = mongoose.model('User');
var plugin = require('../lib/attachments.js');

describe('not an image', function(){

  it('uploads pdf files correctly', function(done){
    var user = new User({});
    var path = { path: process.cwd() + '/test/fixtures/sample.pdf' };
    user.attach('document', path, function(err) {
      expect(user.document.original.defaultUrl).to.include('tmp/document/' + user.id + '-original.pdf');
      done();
    });
  });

});
