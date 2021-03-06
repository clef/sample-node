# Clef + Node
![license:mit](https://img.shields.io/badge/license-mit-blue.svg)
![platform:node](https://img.shields.io/node/v/gh-badges.svg)<br>

## Getting started
Clef is secure two-factor auth without passwords. With the wave of their phone, users can log in to your site — it's like :sparkles: magic :sparkles:! 

Get started in three easy steps:
* Download the [iOS](https://itunes.apple.com/us/app/clef/id558706348) or [Android](https://play.google.com/store/apps/details?id=io.clef&hl=en) app on your phone 
* Sign up for a Clef developer account at [https://www.getclef.com/developer](https://www.getclef.com/developer) and create an application. That's where you'll get your API credentials (`app_id` and `app_secret`) and manage settings for your Clef integration.
* Follow the directions below to integrate Clef into your site's log in flow. 

## Usage
We'll walk you through the full Clef integration with Node and Express below. You can also run a version of this sample app [locally](#running-this-sample-app).

### Adding the Clef button

The Clef button is the entry point into the Clef experience. Adding it to your site is as easy as dropping a `script` tag wherever you want the button to show up. 

Set the `data-redirect-url` to the URL in your app where you will complete the OAuth handshake. You'll also want to set `data-state` to an unguessable random string. <br>

```javascript
<script type='text/javascript'
  class='clef-button'
  src='https://clef.io/v3/clef.js'
  data-app-id='YOUR_APP_ID'
  data-redirect-url='http://localhost:4000/login'
  data-state='<%=state%>'
></script>
```
*See the code in [action](/views/index.ejs#L14-L20) or read more [here](http://docs.getclef.com/v1.0/docs/adding-the-clef-button).*<br>

### Completing the OAuth handshake
Once you've set up the Clef button, you need to be able to handle the OAuth handshake. This is what lets you retrieve information about a user after they authenticate with Clef. The easiest way to do this is to use the Clef API package for Node, which you can install via `npm`:

`$ npm install clef`

To use it, pass your `app_id` and `app_secret` to the ClefAPI constructor:           
```javascript
var clef = require('clef').initialize({appID: APP_ID, appSecret: APP_SECRET});
```

Then at the route you created for the OAuth callback, access the `code` URL parameter and exchange it for user information. 

Before exchanging the `code` for user information, you first need to verify the `state` parameter sent to the callback to make sure it's the same one as the one you set in the button. (You can find implementations of the <code><a href="/app.js#L94-L98" target="_blank">stateParameterIsValid</a></code> and <code><a href="/app.js#L86-L92" target="_blank">generateRandomStateParameter</a></code> functions in `app.js`.) 

```javascript

app.get('/login', function(req, res) {
  // If the state parameter doesn't match what we passed into the Clef button,
  // then this request could have been generated by a 3rd party, so we should
  // abort it.
  var state = req.query.state;
  if (!stateParameterIsValid(req.session, state)) {
      return res.status(403).send("Oops, the state parameter didn't match what was passed in to the Clef button.");
  }

  var code = req.query.code;
  clef.getLoginInformation({code: code}, function(err, userInformation) {
    if (err) {
      // Handle the error
      }
    } else {
      var clefID = userInformation['clef_id'];
      var email = userInformation['email'];
      // Fetch a user given the `id` returned by Clef. If the user doesn't
      // exist, it is created with the email address and `id` returned by Clef.
      User.findOrCreate({where: {clefID: clefID}, defaults: {email: email}})
        .spread(function(user, created) {
          req.session.user = {
            id: user.id,
            loggedInAt: Date.now()
          }
        res.redirect('/');
      });
    }
  });
});
```
*See the code in [action](/app.js#L119-L167) or read more [here](http://docs.getclef.com/v1.0/docs/authenticating-users).*<br>

### Logging users out 
Logout with Clef allows users to have complete control over their authentication sessions. Instead of users individually logging out of each site, they log out once with their phone and are automatically logged out of every site they used Clef to log into.

To make this work, you need to [set up](#setting-up-timestamped-logins) timestamped logins, handle the [logout webhook](#handling-the-logout-webhook) and [compare the two](#checking-timestamped-logins) every time you load the user from your database. 

#### Setting up timestamped logins
Setting up timestamped logins is easy. You just add a timestamp to the session everywhere in your application code that you do the Clef OAuth handshake:

```javascript
req.session.user = {
    id: user.id,
    loggedInAt: Date.now()
}
```

*See the code in [action](/app.js#L159-L162) or read more [here](http://docs.getclef.com/v1.0/docs/checking-timestamped-logins)*

#### Handling the logout webhook
Every time a user logs out of Clef on their phone, Clef will send a `POST` to your logout hook with a `logout_token`. You can exchange this for a Clef ID:

```javascript
app.post('/logout', function(req, res) {
  var token = req.body.logout_token;
  clef.getLogoutInformation({logoutToken: token}, function(err, clefID){
    if (err) {
      console.log(err);
    } else {
      User.find({where: {clefID: clefID}}).then(function(user){
        user.updateAttributes({
          loggedOutAt: Date.now()
        }).then(function() {
          res.send('bye');
        });
      });
    }
  });
});
```
*See the code in [action](/app.js#L177-L192) or read more [here](http://docs.getclef.com/v1.0/docs/handling-the-logout-webhook).*<br>

You'll want to make sure you have a `loggedOutAt` attribute on your `User` model. Also, don't forget to specify this URL as the `logout_hook` in your Clef application settings so Clef knows where to notify you.

#### Checking timestamped logins
Every time you load user information from the database, you'll want to compare the `loggedInAt` property to the `loggedOutAt` property. If `loggedOutAt` is after `loggedInAt`, the user's session is no longer valid and they should be logged out of your application.

An easy way to do this is to add a middleware function that destroys the user's session in the browser if the user has already logged out: 
```javascript
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
```
*See the code in action [here](/app.js#L73-L84) or read more [here](http://docs.getclef.com/v1.0/docs/checking-timestamped-logins)*

## Running this sample app 
To run this sample app, clone the repo:

```
$ git clone https://github.com/clef/sample-node.git
```

Then install the dependencies and run on localhost.
```
$ npm install 
$ npm start
```

## Documentation
You can find our most up-to-date documentation at [http://docs.getclef.com](http://docs.getclef.com/). It covers additional topics like customizing the Clef button and testing your integration.

## Support
Have a question or just want to chat? Send an email to [support@getclef.com](mailto: support@getclef.com).

We're always around, but we do an official Q&A every Friday from 10am to noon PST :) — would love to see you there! 

## About 
Clef is an Oakland-based company building a better way to log in online. We power logins on more than 80,000 websites and are building a beautiful experience and inclusive culture. Read more about our [values](https://getclef.com/values), and if you like what you see, come [work with us](https://getclef.com/jobs)!




