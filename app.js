const express = require("express");
const ejs = require("ejs");
const path = require("path");
const bodyParser = require("body-parser");
const methodOverride = require("method-override");
const cookieSession = require("cookie-session");
const passport = require('passport');
const mongoose = require("mongoose");
const socket = require("socket.io");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const keys = require("./rootaccess.js");
const middleware = require("./middleware");
const { PassThrough } = require("stream");

const app = express();

//mongoose.connect(process.env.DATABASEURL, {useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false });
 mongoose.connect("mongodb://localhost:27017/swiftprep-videos", {useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false });


app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended : true }));
app.use(methodOverride("_method"));
app.use(cookieSession({
    maxAge: 6*60*60*1000,
    keys: [keys.session.cookieKey]
}))


//MongoDB Schemas
var userSchema = new mongoose.Schema({
    username: String,
    googleID: String,
    dp: String,
    loggedDevices: {type: Number, default: 0}
});
var User = mongoose.model("User", userSchema);

var commentSchema = new mongoose.Schema({
    text: String,
    created: {type: Date, default: Date.now},
    author: {
          id: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User"
          },
         username: String,
         dp: String,
         },
    replies: [{
            id: mongoose.Schema.Types.ObjectId,
            text: String,
            created: {type: Date, default: Date.now},
            author: {
                id: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User"
                },
               username: String,
               dp: String,
              }
    }]
});
var Comment = mongoose.model("Comment", commentSchema);

var videoSchema = new mongoose.Schema({
    CBS: String,
    Subject: String,
    SubShort: String,
    Chapter: Number,
    VName: String,
    Mentor: String,
    comments: [
        {
           type: mongoose.Schema.Types.ObjectId,
           ref: "Comment"
        }
    ]
});
var Video = mongoose.model("Video", videoSchema);

var Reply = {
    text: String,
    author: {
        id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
       username: String,
       dp: String,
      }
}

//Passport config
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done)=> {
    done(null, user.id);
});
passport.deserializeUser((id, done) => {
    User.findById(id).then((user) => {
        done(null, user);
    })
})

passport.use(
    new GoogleStrategy({
        // options for google strategy
        callbackURL: '/google/redirect',
        clientID: keys.google.clientID,
        clientSecret: keys.google.clientSecret
    }, (accessToken, refreshToken, profile, done) => {
        // passport callback function
        User.findOne({googleID: profile.id}).then((currentUser) => {
            if(currentUser) {
                console.log(profile);
                console.log("user is : " + currentUser);
                done(null, currentUser);
            } else {
                new User({
                    username: profile.displayName,
                    googleID: profile.id,
                    dp: profile.photos[0].value,
                }).save().then((newUser) => {
                    console.log("new user created: " + newUser);
                    done(null, newUser);
                });
            }
        })
    })
);


app.use(function(req, res, next){
    res.locals.currentUser = req.user;
    next();
 });

 //homepage
app.get('/', function(req, res) {
    res.render('index');
});

// filter page
app.get('/filter', function(req, res) {
    res.render('filter');
})

//listing subjects
app.post('/filter', function(req, res) {
    var cbs = req.body.college + "-" + req.body.branch + "-" + "5";
    Video.find({CBS: cbs}, function(err, foundVideos) {
        if(err) {
            console.log(err);
        } else {
            Video.aggregate([{
            $match: { "CBS": cbs}},
            {$group: { 
                _id: "$Subject" }
            }], function(err, subUnique) {
                if(err) {
                    console.log(err);
                } else {
                    res.render("list", {videos: foundVideos, subunique: subUnique});
                }
            });
        }
    })
})

//View video page
app.get('/view/:id', function(req, res) {
    if(req.user) {
        Video.findById(req.params.id).populate("comments").exec(function(err, foundVideo) {
            if(err) {
                console.log(err);
            } else {
                
                res.render('results1', {bucket: keys.gcp.bucket, link: keys.gcp.link, video: foundVideo});
            }
        })
    } else {
        res.redirect('/google');
    }
    
});
app.get('/view/:id/comment', function(req, res) {
    if(req.user) {
        Video.findById(req.params.id).populate("comments").exec(function(err, foundVideo) {
            if(err) {
                console.log(err);
            } else {
                
                res.render('results2', {bucket: keys.gcp.bucket, link: keys.gcp.link, video: foundVideo});
            }
        })
    } else {
        res.redirect('/google');
    }
    
});
//Add a comment
app.post('/view/:id/comment', function(req, res) {
    Video.findById(req.params.id, function(err, foundVideo) {
        if(err) {
            console.log(err);
        } else {
            Comment.create({text: req.body.comment}, function(err, newComment) {
                if(err) {
                    console.log(err); 
                } else {
                    newComment.author.username = req.user.username;
                    newComment.author.id = req.user._id;
                    newComment.author.dp = req.user.dp;
                    newComment.save();
                    foundVideo.comments.push(newComment);
                    foundVideo.save();
                   // res.render('results1', {bucket: keys.gcp.bucket, link: keys.gcp.link, video: foundVideo})
                   // res.end(newComment)
                   res.redirect('/view/' + foundVideo._id +'/comment');
                }
            })
        }
    })
});

//Delete a comment
app.delete('/view/:id/:commentId', function(req, res) {
    Comment.findByIdAndRemove(req.params.commentId, function(err){
        if(err){
            console.log(err);
            res.redirect("/");
        }
        else{
            res.redirect("/view/" + req.params.id +'/comment');
        }
    })
})

//Add a reply
app.post('/view/:id/:commentId/reply', function(req, res) {
    Video.findById(req.params.id, function(err, foundVideo) {
        if(err) {
            console.log(err);
        } else {
            Comment.findById(req.params.commentId, function(err, foundComment) {
                if(err) {
                    console.log(err);
                } else {
                    Reply.text = req.body.reply;
                    Reply.author.username = req.user.username;
                    Reply.author.id = req.user._id;
                    Reply.author.dp = req.user.dp;
                    foundComment.replies.push(Reply);
                    foundComment.save();
                    console.log(foundComment);
                    res.redirect('/view/' + foundVideo._id+'/comment');
                }
            })
        }
    })
})

//Delete a reply
app.delete('/view/:id/:commentId/:replyId', function(req, res) {
    Comment.updateOne({_id: req.params.commentId}, { "$pull": { replies: {_id: req.params.replyId} } }, function(err, foundComment){
        if(err){
            console.log(err);
            res.redirect("/");
        }
        else{
            res.redirect("/view/" + req.params.id+'/comment');
        }
    })
})

//Login page
app.get('/google', passport.authenticate('google', {
    scope: ['profile'],
    prompt: 'select_account'
})
);

//Passport auth
app.get('/google/redirect', passport.authenticate('google'), function(req, res) {
    res.redirect('/filter');
});

//logout page
app.get('/logout', function(req, res) {
    req.logout();
    res.redirect('/');
});

//listener
//app.listen(process.env.PORT, process.env.IP, function(){
  //  console.log("SERVER IS RUNNING!");
//})
 app.listen(3000, 'localhost', function(){
     console.log("SERVER IS RUNNING!");
 })







 
// var io = socket(server);
// io.on('connection', (socket) => {
//     console.log("Made socket connection.");

//     socket.on('play', function(curUser) {
//         User.findById(curUser, function(err, foundUser) {
//             foundUser.loggedDevices++;
//             console.log(foundUser.loggedDevices);
//             socket.emit('play', foundUser.loggedDevices);
//         });
//     });

//     socket.on('pause', function(curUser) {
//         User.findById(curUser, function(err, foundUser) {
//             foundUser.loggedDevices--;
//             console.log(foundUser.loggedDevices);
//             socket.emit('pause', foundUser.loggedDevices);
//         });
//     });
// });

// Video.create({CBS: 'PES-CSE-5', Subject: 'Machine Intelligence', SubShort: 'MI', Chapter: 1, VName: 'PES-CSE-5-MI-1', Mentor: 'Aditya'});
// Video.create({CBS: 'PES-CSE-5', Subject: 'Machine Intelligence', SubShort: 'MI', Chapter: 2, VName: 'PES-CSE-5-MI-2', Mentor: 'Aditya'});
// Video.create({CBS: 'PES-ECE-5', Subject: 'Computer Organization', SubShort: 'CO', Chapter: 1, VName: 'PES-CSE-5-CO-1', Mentor: 'Aditya'});
