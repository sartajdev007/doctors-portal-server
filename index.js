const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config()
const app = express()

const port = process.env.PORT || 5000

// middlewares
app.use(cors())
app.use(express.json())



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ddhvpui.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        const appointmentOptsCollection = client.db('DoctorsPortal').collection('appointmentOpts')
        const bookingCollection = client.db('DoctorsPortal').collection('bookings')

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