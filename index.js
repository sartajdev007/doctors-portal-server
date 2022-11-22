const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken')
const app = express()

const port = process.env.PORT || 5000

// middlewares
app.use(cors())
app.use(express.json())



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ddhvpui.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1]

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' })
        }
        req.decoded = decoded
        next()
    })
}


async function run() {
    try {
        const appointmentOptsCollection = client.db('DoctorsPortal').collection('appointmentOpts')
        const bookingCollection = client.db('DoctorsPortal').collection('bookings')
        const usersCollection = client.db('DoctorsPortal').collection('users')
        const doctorsCollection = client.db('DoctorsPortal').collection('doctors')
        const paymentsCollection = client.db('DoctorsPortal').collection('payments')

        // make sure to use after verifyJWT
        const verifyAdmin = async (req, res, next) => {
            console.log(req.decoded.email)
            const decodedEmail = req.decoded.email
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden' })
            }
            next()
        }



        app.get('/appointmentOpts', async (req, res) => {
            const date = req.query.date
            const query = {}
            const options = await appointmentOptsCollection.find(query).toArray()
            const bookingQuery = { selectedDate: date }
            const alreadyBooked = await bookingCollection.find(bookingQuery).toArray()
            options.forEach(option => {
                const bookedOption = alreadyBooked.filter(book => book.treatment === option.name)
                const bookedSlots = bookedOption.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots
            })
            res.send(options)
        })

        app.get('/appointmentspecialty', async (req, res) => {
            const query = {}
            const result = await appointmentOptsCollection.find(query).project({ name: 1 }).toArray()
            res.send(result)
        })



        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email
            const decodedEmail = req.decoded.email

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            const query = { email: email }
            const bookings = await bookingCollection.find(query).toArray()
            res.send(bookings)
        })

        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const booking = await bookingCollection.findOne(query)
            res.send(booking)
        })


        app.post('/bookings', async (req, res) => {
            const booking = req.body

            const query = {
                selectedDate: booking.selectedDate,
                email: booking.email
            }

            const alreadyBooked = await bookingCollection.find(query).toArray()
            if (alreadyBooked.length) {
                const message = `You already have an appointment on ${booking.selectedDate}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingCollection.insertOne(booking)
            res.send(result)
        })


        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create(
                {
                    currency: 'usd',
                    amount: amount,
                    "payment_method_types": [
                        "card"
                    ]
                }
            )
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body
            const result = await paymentsCollection.insertOne(payment)
            const id = payment.bookingId
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })

        app.get('/jwt', async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            }
            console.log(user)
            res.status(403).send({ accessToken: '' })
        })

        app.get('/users', async (req, res) => {
            const query = {}
            const users = await usersCollection.find(query).toArray()
            res.send(users)
        })


        // app.get('users/admin/:email', async (req, res) => {
        //     const email = req.params.email
        //     console.log(email)
        //     const query = { email: email }
        //     const user = await usersCollection.findOne(query)
        //     res.send({ isAdmin: user?.role === 'admin' })
        // })

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })


        app.post('/users', async (req, res) => {
            const user = req.body
            const result = await usersCollection.insertOne(user)
            res.send(result)
        })

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true }
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options)
            res.send(result)
        })



        // temporary function to update price field on appointment option
        app.get('/addprice', async (req, res) => {
            const filter = {}
            const options = { upsert: true }
            const updatedDoc = {
                $set: {
                    price: 99
                }
            }
            const result = await appointmentOptsCollection.updateMany(filter, updatedDoc, options)
            res.send(result)
        })


        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {}
            const doctors = await doctorsCollection.find(query).toArray()
            res.send(doctors)

        })
        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body
            const result = await doctorsCollection.insertOne(doctor)
            res.send(result)

        })

        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const filter = { _id: ObjectId(id) }
            const result = await doctorsCollection.deleteOne(filter)
            res.send(result)
        })


    }
    finally {

    }

}
run().catch(console.log)


app.get('/', (req, res) => {
    res.send('Server Running')
})

app.listen(port, () => {
    console.log(`Doctors portal running on ${port}`)
})