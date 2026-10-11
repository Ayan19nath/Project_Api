// REGISTER
router.post('/', async (req, res) => {
    try {
        const { Email, Password } = req.body;

        if (!Email || !Password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        // check if the email is already registered
        const user = await User.findOne({ Email });
        if (user) {
            return res.status(409).json({
                message: "You are already registered"
            });
        }

        // hash the password before saving
        const hashedPassword = await bcrypt.hash(Password, 10);

        const newUser = new User({
            ...req.body,
            Password: hashedPassword
        });
        const save = await newUser.save();

        // don't send the password back to the client
        const { Password: _removed, ...safeUser } = save.toObject();
        res.status(201).json(safeUser);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    try {
        const { Email, Password } = req.body;

        if (!Email || !Password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        // select('+Password') is needed because the schema hides it by default
        const user = await User.findOne({ Email }).select('+Password');
        if (!user) {
            return res.status(404).json({
                message: "Invalid email details"
            });
        }

        const isPassCorrect = await user.comparePassword(Password);
        if (!isPassCorrect) {
            return res.status(404).json({
                message: "Invalid password details"
            });
        }

        // don't send the password back to the client
        const { Password: _removed, ...safeUser } = user.toObject();
        res.json(safeUser);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


/*router.get('/' ,async  (req,res) => {
    try{
    const allcategory =  await Category.find()
    res.json(allcategory)
    }catch(err){
        res.json({
        message:err.message})
    }
} );*/

/*router.post('/' ,async  (req,res) => {
    try{
        const newUser=new User(req.body);
        //console.log(req.body)
        const save= await newUser.save();
        res.json(save);
    }catch(err){
        res.json({message:err.message})
    }
});*/

/*router.delete('/:id',async (req, res)=>{
    id=req.params.id
    try{
        const delCategory= await Category.findByIdAndDelete(id)
        if(!delCategory){
            return res.status(400).json({
                message:"Category details not found."
            })
        }else{
            return res.json(delCategory);
        }
    }catch(err){
        return res.json({
            message:err.message
        })
    }
});

router.put('/:id', async (req, res) => {
    try {
        const updCategory = await Category.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (!updCategory) {
            return res.json({
                message: "Category not updated"
            });
        }
        return res.json(updCategory);
    } catch (err) {
        return res.json({
            message: err.message
        });
    }
});

module.exports=router;*/