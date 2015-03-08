
/**
 * Module dependencies.
 */

var express = require('express')
  , http = require('http')
  , path = require('path')
  , request = require('request')
  , Sequelize = require('sequelize');

var sequelize = new Sequelize('sample_app', 'username', 'password', {
  host: 'localhost',
  dialect: 'sqlite',

  pool: {
    max: 5,
    min: 0,
    idle: 10000
  },

  storage: './sample_app.sqlite'
});

var User = sequelize.define('user', {
  id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
  },
  email: {
    type: Sequelize.STRING
  },
  clefID: {
    type: Sequelize.INTEGER
  },
  loggedOutAt: {
    type: Sequelize.DATE
  },
});

var app = express();

app.configure(function(){
  app.set('port', process.env.PORT || 4000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser('your secret here'));
  app.use(express.session());
});

app.configure('development', function() {
  app.use(express.errorHandler());
});

var APP_ID = '4f4baa300eae6a7532cc60d06b49e0b9',
    APP_SECRET = 'd0d0ba5ef23dc134305125627c45677c';

/**
 * This middleware function is used to check whether the user has logged out
 * with Clef already, and if so, destroys their session in the browser,
 * logging them out.
 *
 * For more info, see http://docs.getclef.com/v1.0/docs/checking-timestamped-logins
 */
app.use(function(req, res, next) {
  if (req.session.user == undefined) { return next(); }

  User.find({ where: { id: req.session.user.id } }).then(function(user) {
    if (!user || user.loggedOutAt == null || user.loggedOutAt < req.session.user.loggedInAt) {
      next();
    } else {
      req.session.destroy();
      res.redirect('/');
    }
  })
});

/**
 * Shows user information, or shows the Clef login button.
 */
app.get('/', function(req, res) {
  var userID = req.session.user && req.session.user.id;
  User.find({ where: { id: userID } }).then(function(user) {
    res.render('index', { user: user });
  });
});

/**
 * Does an OAuth handshake with Clef to get user information.
 *
 * This route is redirected to automatically by the browser when a user
 * logs in with Clef.
 *
 * For more info, see http://docs.getclef.com/v1.0/docs/authenticating-users
 */
app.get('/login', function(req, res) {
  var code = req.param('code');
  var authorizeURL = 'https://clef.io/api/v1/authorize';
  var infoURL = 'https://clef.io/api/v1/info';
  var form = {
    app_id: APP_ID,
    app_secret: APP_SECRET,
    code: code
  };

  request.post({url: authorizeURL, form: form}, function(error, response, body) {
    var token = JSON.parse(body)['access_token'];
    request.get({url: infoURL, qs: {access_token: token}},
      function(error, response, body) {
        var userData = JSON.parse(body)['info'];

        // Fetch a user given the `id` returned by Clef. If the user doesn't
        // exist, it is created with the email address and `id` returned by Clef.
        User.findOrCreate({where: {clefID: userData.id}, defaults: {email: userData.email}})
        .spread(function(user, created) {
            req.session.user = {
              id: user.id,
              loggedInAt: Date.now()
            }
            res.redirect('/');
        });
      });
  });
});

/**
 * Handles logout hook requests sent by Clef when a user logs out on their phone.
 *
 * This method looks up a user by their `clefID` and updates the database to
 * indicate that they've logged out.
 *
 * For more info, see http://docs.getclef.com/v1.0/docs/database-logout
 */
app.post('/logout', function(req, res) {
  var token = req.param('logout_token');
  var logoutURL = 'https://clef.io/api/v1/logout';
  var form = {
    app_id: APP_ID,
    app_secret: APP_SECRET,
    logout_token: token
  };

  request.post({url: logoutURL, form:form}, function(err, response, body) {
    var response = JSON.parse(body);

    if (response.success) {
      User.find({where: {clefID: response.clef_id}}).then(function(user) {
        user.updateAttributes({
          loggedOutAt: Date.now()
        }).then(function () {
          res.send('bye');
        });
      });
    } else {
      console.log(body['error']);
      res.send('bye');
    }
  });
});

sequelize.sync().then(function () {
  http.createServer(app).listen(app.get('port'), function() {
    console.log("Express server listening on port " + app.get('port'));
  });
})
