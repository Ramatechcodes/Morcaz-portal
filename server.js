require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const axios = require("axios");
const nodemailer = require("nodemailer");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ================= EMAIL SYSTEM =================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ================= APPLICATION =================
app.post("/apply", upload.single("passport"), async (req, res) => {

const data = req.body
const reference = data.reference

try{

// VERIFY PAYMENT
const verify = await axios.get(
`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${reference}`,
{
headers:{
Authorization:`Bearer ${process.env.FLUTTERWAVE_SECRET}`
}
})

if(verify.data.status !== "success"){
return res.json({message:"Payment not verified"})
}

// Upload passport
let passportUrl=null

if(req.file){
const fileName=Date.now()+"_"+req.file.originalname

await supabase.storage
.from("passports")
.upload(fileName,req.file.buffer)

passportUrl=`${process.env.SUPABASE_URL}/storage/v1/object/public/passports/${fileName}`
}

// Generate ID
const studentId="MRZ"+Math.floor(10000+Math.random()*90000)

// Generate password
const passwordPlain=Math.random().toString(36).slice(-8)

const hashed=await bcrypt.hash(passwordPlain,10)

// Save student
await supabase.from("students").insert([{

full_name:data.name,
email:data.email,
phone:data.phone,
nin:data.nin,
state_origin:data.origin,
state_residence:data.residence,
previous_school:data.prevschool,
class_applying:data.class,
parent_name:data.parent,
passport:passportUrl,
student_id:studentId,
password:hashed,
payment_status:true

}])

// SEND EMAIL
await transporter.sendMail({

from:process.env.EMAIL_USER,
to:data.email,
subject:"Morcaz Uloom Student Portal Login",

text:`Welcome to Morcaz Uloom Portal

Student ID: ${studentId}
Password: ${passwordPlain}

Login here:
https://morcaz-uloom-ejigbo-ng.onrender.com`

})

res.json({
message:"Application successful. Login details sent to email."
})

}catch(err){

console.log(err)

res.json({message:"Application failed"})

}

})// ================= PAYMENT VERIFY =================
app.post("/verify-payment", async (req, res) => {
  const { reference, email } = req.body;

  try {
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${reference}`,
      { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET}` } }
    );

    if (response.data.status === "success") {
      // Mark student as paid
      const { data: student } = await supabase
        .from("students")
        .select("*")
        .eq("email", email)
        .single();

      await supabase.from("students").update({ payment_status:true }).eq("email", email);

    

      // Remove temporary password
      await supabase.from("students").update({ password_plain: null }).eq("email", email);

      res.json({ message: "Payment verified, login credentials sent to email." });
    } else {
      res.json({ message: "Payment failed." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error verifying payment." });
  }
});

app.post("/save-payment", async (req,res)=>{

const {studentId,type,amount,reference} = req.body

await supabase.from("payments").insert([{
student_id:studentId,
payment_type:type,
amount,
reference
}])

res.json({message:"Payment saved"})

})
app.get("/payment-history/:id", async (req,res)=>{

const {data} = await supabase
.from("payments")
.select("*")
.eq("student_id",req.params.id)

res.json(data)

})
// ================= LOGIN =================
app.post("/login", async (req, res) => {

try{

const { studentId, password } = req.body

console.log("LOGIN:", studentId)

const { data, error } = await supabase
.from("students")
.select("*")
.eq("student_id", studentId)
.single()

if(error || !data){
return res.json({ error:"Student not found" })
}

if(!data.payment_status){
return res.json({ error:"Payment not verified" })
}

const match = await bcrypt.compare(password, data.password)

if(!match){
return res.json({ error:"Wrong password" })
}

res.json({

success:true,
name:data.full_name,
passport:data.passport,
email:data.email,
class:data.class_applying

})

}catch(err){

console.error("LOGIN ERROR:", err)

res.status(500).json({ error:"Server error" })

}

})

app.post("/staff-login", async (req,res)=>{

  const { username, password } = req.body;

  const { data } = await supabase
    .from("staff")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if(!data){
    return res.json({ error:"Staff not found" });
  }

  const match = await bcrypt.compare(password,data.password);

  if(!match){
    return res.json({ error:"Wrong password" });
  }

  res.json({
    success:true,
    name:data.full_name,
    course:data.courses
  });

});
app.post("/staff/add-question", async (req,res)=>{

const {course,className,question,a,b,c,d,answer} = req.body

await supabase.from("cbt_questions").insert([{
course,
class:className,
question,
option_a:a,
option_b:b,
option_c:c,
option_d:d,
answer
}])

res.json({message:"Question added"})

})

app.get("/result/:id", async (req,res)=>{

const {session,term} = req.query

let query = supabase
.from("results")
.select("*")
.eq("student_id",req.params.id)

if(session) query = query.eq("session",session)
if(term) query = query.eq("term",term)

const {data} = await query

res.json(data)

})
app.get("/cbt/:course/:class", async (req,res)=>{

const {data} = await supabase
.from("cbt_questions")
.select("*")
.eq("course",req.params.course)
.eq("class",req.params.class)

res.json(data)

})

app.post("/cbt/save-result", async (req,res)=>{

const {studentId,course,score} = req.body

// Save result
await supabase.from("cbt_results").insert([{
student_id:studentId,
course,
score
}])

// Delete questions for that course
await supabase
.from("cbt_questions")
.delete()
.eq("course",course)

res.json({message:"Result saved and questions cleared"})
})


// ================= PASSWORD RESET =================
app.post("/change-password", async (req, res) => {
  const { studentId, newPassword } = req.body;
  const hash = await bcrypt.hash(newPassword, 10);

  await supabase.from("students").update({ password: hash }).eq("student_id", studentId);
  res.json({ message: "Password updated." });
});

// ================= ADMIN ENDPOINTS =================
app.get("/admin/students", async (req, res) => {
  const { data } = await supabase.from("students").select("*");
  res.json(data);
});

// Add course manually
app.post("/register-course", async (req,res)=>{

const {studentId,course} = req.body

await supabase.from("courses").insert([{
student_id:studentId,
course_name:course
}])

res.json({message:"Course saved"})

})

// Add result manually
app.post("/admin/result", async (req,res)=>{

const {studentId,subject,score,className,session,term} = req.body

await supabase.from("results").insert([{
student_id:studentId,
subject,
score,
class:className,
session,
term
}])

res.json({message:"Result saved"})

})
// Fetch student courses
app.get("/courses/:id", async (req, res) => {
  const { data } = await supabase.from("courses").select("*").eq("student_id", req.params.id);
  res.json(data);
});
// ================= STAFF REGISTRATION =================
app.post("/staff/register", async (req,res) => {

  const { full_name, username, course } = req.body;
  const fixedPassword = "morcas123";

  try {

    // Check if username already exists
    const { data: existing } = await supabase
      .from("staff")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if(existing){
      return res.json({ error: "Username already exists" });
    }

    // Hash fixed password
    const hashed = await bcrypt.hash(fixedPassword,10);

    // Insert new staff
    await supabase.from("staff").insert([{
      full_name,
      username,
      courses: course,
      password: hashed
    }]);

    res.json({
      message:"Staff registration successful. Login using your username and the fixed password."
    });

  } catch(err){

    console.error(err);
    res.status(500).json({ error:"Staff registration failed" });

  }

});
app.listen(process.env.PORT, () => {
  console.log("Server running on port", process.env.PORT);
});
