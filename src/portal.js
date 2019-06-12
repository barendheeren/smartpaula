const express = require('express');
const cookieParser = require('cookie-parser');
const router = express.Router();
const bodyParser = require('body-parser');
const { Pool, Client } = require('pg');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const Sequelize = require('sequelize');
const bcrypt = require('bcrypt-nodejs');
const flash = require('connect-flash');

const Facebook = require('./services/facebook');

const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET;

/** @const {Pool} Postgres connection pool */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** @const {Facebook} Facebook API interface */
const facebook = new Facebook(FB_VERIFY_TOKEN, FB_PAGE_ACCESS_TOKEN);

const sequelize = new Sequelize('postgres://cxhecgetssavcf:7fed96c96e56d7667a48fd2ad7598c48b09a5607ce76eee1776475865d3b2c1d@ec2-54-247-189-141.eu-west-1.compute.amazonaws.com:5432/d4a7kcqadn0dei');

// Test Database connection
sequelize
    .authenticate()
    .then(() => {
        console.log('Connection has been established successfully.');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
    });

const User = sequelize.define('user', {
    first_name: {
        type: Sequelize.STRING
    },
    last_name: {
        type: Sequelize.STRING
    },
    email: {
        type: Sequelize.STRING
    },
    password: {
        type: Sequelize.STRING
    },
    admin: {
        type: Sequelize.BOOLEAN
    }
}, {
        underscored: true,
        instanceMethods: {


        }
    });

User.generateHash = function (password) {
    return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
}

User.prototype.validPassword = function (password) {
    return bcrypt.compareSync(password, this.password);
}

User.sync();

function getUser(rows, callback, onComplete) {
    if (rows.length) {
        let user = rows.shift();
        facebook.getProfile(user.fbuser, (profile) => { profile.id = user.fbuser; callback(profile); getUser(rows, callback, onComplete) });
    } else {
        onComplete()
    }
}

function getAllUsers(callback) {
    //pool.query("SELECT fbuser FROM vragenlijsten GROUP BY fbuser UNION SELECT fbuser FROM connect_nokia UNION SELECT fbuser FROM connect_wunderlist")
    pool.query("SELECT client FROM vragenlijsten GROUP BY client UNION SELECT client FROM connect_nokia UNION SELECT client FROM connect_wunderlist")
        .then(result => {
            let users = [];
            getUser(result.rows,
                (profile) => {
                    users.push({ id: profile.id, name: profile.first_name + ' ' + profile.last_name });
                },
                () => {
                    callback(users)
                });
        });
}

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated())
        return next();

    res.redirect('/portal/login');
}

function isAdmin(req, res, next) {
    if (req.user.admin)
        return next();

    res.redirect('/portal/');
}

passport.use(new LocalStrategy(
    function (username, password, done) {
        User.findOne({ where: { email: username } }).then(user => {
            if (!user) {
                return done(null, false, { message: 'Incorrect username.' });
            }
            if (!user.validPassword(password)) {
                return done(null, false, { message: 'Incorrect password.' });
            }
            return done(null, user);
        });
    }
));

passport.serializeUser(function (user, done) {
    done(null, user.id);
});

passport.deserializeUser(function (id, done) {
    User.findById(id).then(user => {          
        done(null, user);
    });
});

passport.use('local-signup', new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password',
    passReqToCallback: true
},
    function (req, email, password, done) {
        User.findOne({ where: { 'email': email } })
            .then(user => {
                // check to see if theres already a user with that email
                if (user) {
                    return done(null, false, req.flash('signupMessage', 'That email is already taken.'));
                } else {

                    // if there is no user with that email
                    // create the user
                    User.create({ first_name: req.body.firstname, last_name: req.body.lastname, email: email, password: User.generateHash(password) })
                        .then(user => {
                            return done(null, user);
                        })
                }

            });

    })
);

passport.use('local-login', new LocalStrategy({
    // by default, local strategy uses username and password, we will override with email
    usernameField: 'email',
    passwordField: 'password',
    passReqToCallback: true // allows us to pass back the entire request to the callback
},
    function (req, email, password, done) { // callback with email and password from our form

        // find a user whose email is the same as the forms email
        // we are checking to see if the user trying to login already exists
        User.findOne({ where: { 'email': email } }).then(user => {

            // if no user is found, return the message
            if (!user)
                return done(null, false, req.flash('loginMessage', 'No user found.')); // req.flash is the way to set flashdata using connect-flash

            // if the user is found but the password is wrong
            if (!user.validPassword(password))
                return done(null, false, req.flash('loginMessage', 'Oops! Wrong password.')); // create the loginMessage and save it to session as flashdata

            // all is well, return successful user
            return done(null, user);
        })
    })
);

const app = express();

app.use(cookieParser());
app.use(bodyParser());

app.set('view engine', 'pug');

app.use(session({ secret: SESSION_SECRET })); // session secret
app.use(passport.initialize());
app.use(passport.session()); // persistent login sessions
app.use(flash()); // use connect-flash for flash messages stored in session

app.get('/', isLoggedIn, (req, res) => {
    try {
        getAllUsers((users) => {
            res.render('index', { user: req.user, users: users });
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
});

app.post('/', isLoggedIn, (req, res) => {
    try {
        let user = req.body.user;
        res.redirect('/portal/' + user);
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
});

app.get('/login', (req, res) => {
    try {
        res.render('login');

    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
})

app.post('/login', passport.authenticate('local-login', {
    successRedirect: '/portal', // redirect to the secure profile section
    failureRedirect: '/portal/login', // redirect back to the signup page if there is an error
    failureFlash: true // allow flash messages
}));

app.get('/admin', isLoggedIn, isAdmin, (req, res) => {
    try {
        User.findAll().then(users => {
            res.render('admin', { users: users, user: req.user });
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
});

app.get('/admin/:user', isLoggedIn, isAdmin, (req, res) => {
    try {
        let id = req.params.user;
        if (id === 'new') {
            res.render('profile', {
                user: req.user, profile: {
                    id: 'new',
                    first_name: '',
                    last_name: '',
                    email: '',
                    admin: false
                }
            });
        } else {
            User.findById(id).then(user => {
                res.render('profile', { user: req.user, profile: user });
            });
        }
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
});

app.post('/admin/:user', isLoggedIn, isAdmin, (req, res) => {
    try {
        let id = req.params.user;
        let password = req.body.password;
        let admin = req.body.admin;
        let userData = {
            first_name: req.body.firstname,
            last_name: req.body.lastname,
            email: req.body.email,
        }
        if (typeof admin !== 'undefined' && admin) {
            userData.admin = true;
        } else {
            userData.admin = false;
        }
        if (password) {
            userData.password = User.generateHash(password);
        }

        if (id === 'new') {
            User.findOne({ where: { email: userData.email } }).then(user => {
                if (user) {
                    //req.flash('signupMessage', 'That email is already taken.');
                    res.redirect('/portal/admin/new');
                } else {
                    User.create(userData).then(() => {
                        res.redirect('/portal/admin');
                    })
                }
            });
        } else {
            User.findById(id).then(user => {
                user.update(userData).then(() => {
                    res.redirect('/portal/admin');
                });
            });
        }
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
})

app.get('/:user', isLoggedIn, (req, res) => {
    try {
        res.render('user', { user: req.user });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
})

app.get('/:user/data', (req, res) => {
    let user = req.params.user;
    let userData = {};
    //pool.query('SELECT *, to_char(timezone(\'zulu\', to_timestamp(date_part(\'epoch\', vragenlijsten.gestart))),\'YYYY-MM-DDThh24:MI:SSZ\') as date, (SELECT SUM(waarde) FROM antwoorden WHERE antwoorden.vragenlijst = vragenlijsten.id) FROM vragenlijsten WHERE fbuser = $1', [user]).then(result => {
    pool.query('SELECT *, to_char(timezone(\'zulu\', to_timestamp(date_part(\'epoch\', vragenlijsten.gestart))),\'YYYY-MM-DDThh24:MI:SSZ\') as date, (SELECT SUM(waarde) FROM antwoorden WHERE antwoorden.vragenlijst = vragenlijsten.id) FROM vragenlijsten WHERE client = $1', [user]).then(result => {
        userData.lists = { data: [] };
        result.rows.forEach((row) => {
            if (row.date && row.sum) {
                userData.lists.data.push({ x: row.date, y: row.sum })
            }
        });
        //pool.query('SELECT *, to_char(timezone(\'zulu\', to_timestamp(date_part(\'epoch\', antwoorden.antwoord_op))),\'YYYY-MM-DDThh24:MI:SSZ\') as date FROM antwoorden LEFT JOIN vragenlijsten ON antwoorden.vragenlijst = vragenlijsten.id WHERE vragenlijsten.fbuser = $1 ORDER BY antwoorden.antwoord_op ASC', [user]).then(result => {
        pool.query('SELECT *, to_char(timezone(\'zulu\', to_timestamp(date_part(\'epoch\', antwoorden.antwoord_op))),\'YYYY-MM-DDThh24:MI:SSZ\') as date FROM antwoorden LEFT JOIN vragenlijsten ON antwoorden.vragenlijst = vragenlijsten.id WHERE vragenlijsten.client = $1 ORDER BY antwoorden.antwoord_op ASC', [user]).then(result => {    
            userData.questions = { data: [] };
            result.rows.forEach((row) => {
                if (!(row.vraag in userData.questions.data)) {
                    userData.questions.data[row.vraag] = {
                        data: [],
                        label: row.vraag
                    }
                }

                userData.questions.data[row.vraag].data.push({ x: row.date, y: row.waarde })

            });

            userData.questions.data = Object.keys(userData.questions.data).map(function (key) { return userData.questions.data[key] })

            //pool.query('SELECT *, to_char(timezone(\'zulu\', to_timestamp(date_part(\'epoch\', measure_blood.measure_date))),\'YYYY-MM-DDThh24:MI:SSZ\') as date FROM measure_blood WHERE fbuser = $1 ORDER BY measure_date ASC', [user]).then((result) => {
            pool.query('SELECT *, to_char(timezone(\'zulu\', to_timestamp(date_part(\'epoch\', measure_blood.measure_date))),\'YYYY-MM-DDThh24:MI:SSZ\') as date FROM measure_blood WHERE client = $1 ORDER BY measure_date ASC', [user]).then((result) => {    
                userData.blood = {};
                userData.blood.systolic = [];
                userData.blood.diastolic = [];
                userData.blood.pulse = [];
                result.rows.forEach(row => {
                    if (row.systolic) {
                        userData.blood.systolic.push({ x: row.date, y: row.systolic });
                    }
                    if (row.diastolic) {
                        userData.blood.diastolic.push({ x: row.date, y: row.diastolic });
                    }
                    if (row.pulse) {
                        userData.blood.pulse.push({ x: row.date, y: row.pulse });
                    }
                });
                //pool.query('SELECT *, to_char(timezone(\'zulu\', to_timestamp(date_part(\'epoch\', measure_weight.measure_date))),\'YYYY-MM-DDThh24:MI:SSZ\') as date FROM measure_weight WHERE fbuser = $1 ORDER BY measure_date ASC', [user]).then(result => {
                pool.query('SELECT *, to_char(timezone(\'zulu\', to_timestamp(date_part(\'epoch\', measure_weight.measure_date))),\'YYYY-MM-DDThh24:MI:SSZ\') as date FROM measure_weight WHERE client = $1 ORDER BY measure_date ASC', [user]).then(result => {    
                    userData.weight = { data: [] };
                    result.rows.forEach(row => {
                        if (row.weight) {
                            userData.weight.data.push({ x: row.date, y: row.weight });
                        }
                    })
                    res.status(200).json(userData);
                });
            });
        });

    });
});

module.exports = app;
