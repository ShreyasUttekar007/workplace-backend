const express = require("express");
const router = express.Router();
const Mom = require("../models/Mom");
const { roles } = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");

router.use(authenticateUser);

router.post("/mom", async (req, res) => {
  try {
    const momData = req.body;
    if (momData.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }
    const newMom = await Mom.create(momData);
    res.status(201).json(newMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom", async (req, res) => {
  try {
    const moms = await Mom.find().populate("userId");
    res.status(200).json(moms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-by-id/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    console.log("momId::: ", momId);
    const mom = await Mom.findById(momId).populate("userId");

    if (!mom) {
      return res.status(404).json({ error: "MOM not found" });
    }

    res.status(200).json(mom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userRoles = req.user?.roles || [];

    // Check if user is admin
    if (userRoles.includes("admin")) {
      const moms = await Mom.find().populate("userId");
      return res.status(200).json(moms);
    }

    // Check if the requested userId matches the authenticated user's id
    if (userId !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    let moms;
    const zoneRoles = [
      "Eastern Vidarbha",
      "Konkan",
      "Marathwada",
      "Mumbai",
      "Northern Maharashtra",
      "Thane + Palghar",
      "Western Maharashtra",
      "Western Vidarbha",
    ];

    const userZoneRoles = userRoles.filter((role) => zoneRoles.includes(role));
    console.log("userZoneRoles::: ", userZoneRoles);

    // Define constituency roles
    const assemblyConstituencies = [
      "1-Akkalkuwa(ST)",
      "2-Shahada(ST)",
      "3-Nandurbar(ST)",
      "4-Nawapur(ST)",
      "5-Sakri(ST)",
      "6-Dhule Rural",
      "7-Dhule City",
      "8-Sindhkheda",
      "9-Shirpur(ST)",
      "10-Chopda(ST)",
      "11-Raver",
      "12-Bhusawal(SC)",
      "13-Jalgaon City",
      "14-Jalgaon Rural",
      "15-Amalner",
      "16-Erandol",
      "17-Chalisgaon",
      "18-Pachora",
      "19-Jamner",
      "20-Muktainagar",
      "21-Malkapur",
      "22-Buldhana",
      "23-Chikhli",
      "24-Sindhkhed Raja",
      "25-Mehkar(SC)",
      "26-Khamgaon",
      "27-Jalgaon(Jamod)",
      "28-Akot",
      "29-Balapur",
      "30-Aakola West",
      "31-Akola East",
      "32-Murtizapur(SC)",
      "33-Risod",
      "34-Washim(SC)",
      "35-Karanja",
      "36-Dhamangaon Railway",
      "37-Badnera",
      "38-Amrawati",
      "39-Teosa",
      "40-Daryapur(SC)",
      "41-Melghat(ST)",
      "42-Achalpur",
      "43-Morshi",
      "44-Arvi",
      "45-Deoli",
      "46-Hinganghat",
      "47-Wardha",
      "48-Katol",
      "49-Savner",
      "50-Hingna",
      "51-Umred(SC)",
      "52-Nagpur South West",
      "53-Nagpur South",
      "54-Nagpur East",
      "55-Nagpur Central",
      "56-Nagpur West",
      "57-Nagpur North(SC)",
      "58-Kamthi",
      "59-Ramtek",
      "60-Tumsar",
      "61-Bhandara(SC)",
      "62-Sakoli",
      "63-Arjuni Morgaon(SC)",
      "64-Tirora",
      "65-Gondia",
      "66-Amgaon(ST)",
      "67-Armori(ST)",
      "68-Gadchiroli(ST)",
      "69-Aheri(ST)",
      "70-Rajura",
      "71-Chandrapur(SC)",
      "72-Ballarpur",
      "73-Bramhapuri",
      "74-Chimur",
      "75-Warora",
      "76-Wani",
      "77-Ralegaon(ST)",
      "78-Yavatmal",
      "79-Digras",
      "80-Arni(ST)",
      "81-Pusad",
      "82-Umarkhed(SC)",
      "83-Kinwat",
      "84-Hidgaon",
      "85-Bhokar",
      "86-Nanded North",
      "87-Nanded south",
      "88-Loha",
      "89-Naigaon",
      "90-Deglur(sc)",
      "91-Mukhed",
      "92-Basmath",
      "93-Kalamnuri",
      "94-Hingoli",
      "95-Jintur",
      "96-Parbhani",
      "97-Gangakhed",
      "98-Pathri",
      "99-Partur",
      "100-Gansavangi",
      "101-Jalna",
      "102-Badnapur(SC)",
      "103-Bhokardan",
      "104-Sillod",
      "105-Kannad",
      "106-Pholambari",
      "107-Chatrapati Sambhaji Nagar(Central)",
      "108-Chatrapati Sambhaji Nagar(West)(SC)",
      "109-Aurangbad(East)",
      "110-Paithan",
      "111-Gangapur",
      "112-Vaijapur",
      "113-Nandgaon",
      "114-Malegaon(Central)",
      "115-Malegaon(Outer)",
      "116-Baglan(ST)",
      "117-Kalwan(ST)",
      "118-Chandwad",
      "119-Yevla",
      "120-Sinnar",
      "121-Niphad",
      "122-Dindori(ST)",
      "123-Nashik East",
      "124-Nashik(Central)",
      "125-Nashik West",
      "126-Deolali(SC)",
      "127-Igatpuri(ST)",
      "128-Dahanu(ST)",
      "129-Vekramgrth(ST)",
      "130-Palghar(ST)",
      "131-Boisar(ST)",
      "132-Nalasopara",
      "133-Vasai",
      "134-Bhiwandi Rural(ST)",
      "135-Shahapur(ST)",
      "136-Bhiwandi West",
      "137-Bhiwandi East",
      "138-Kalyan West",
      "139-Murbad",
      "140-ambarnath",
      "141-Ulhasnagar",
      "142-Kalyan East",
      "143-Dombivali",
      "144-Kalyan Rural",
      "145-Meera Bhayandar",
      "146-ovala majiwada",
      "147-Kopri-Pachpakhadi",
      "148-Thane",
      "149-Mumbra-Kalwa",
      "150-Airoli",
      "151-Belapur",
      "152-Borivali",
      "153-Dhaisar",
      "154-Magathane",
      "155-Mulund",
      "156-Vikhroli",
      "157-Bhandup West",
      "158-Jogeshwari East",
      "159-Dindoshi",
      "160-Kandivali East",
      "161-Charkop",
      "162-Malad West",
      "163-Goregaon",
      "164-Varsova",
      "165-Andheri West",
      "166-Andheri East",
      "167-Vile Parle",
      "168-Chandivali",
      "169-Ghatkopar West",
      "170-Ghatkopar East",
      "171-Mankhurd Shivajinagar",
      "172-Anushakti Nagar",
      "173-Chembur",
      "174-Kurla (sc)",
      "175-Kalina",
      "176-Vandre East",
      "177-Vandre West",
      "178-Dharavi",
      "179-Sion Koliwada",
      "180-Wadala",
      "181-Mahim",
      "182-Worli",
      "183-Shivadi",
      "184-Byculla",
      "185-Malabar Hill",
      "186-Mumbadevi",
      "187-Colaba",
      "188-Panvel",
      "189-Karjat",
      "190-Uran",
      "191-Pen",
      "192-alibag",
      "193-Shrivardhan",
      "194-mahad",
      "195-Junnar",
      "196-Ambegaon",
      "197-Khed Alandi",
      "198-Shirur",
      "199-Daund",
      "200-Indapur",
      "201-Baramati",
      "202-Purandar",
      "203-Bhor",
      "204-Maval",
      "205-Chinchwad",
      "206-Pimpri(SC)",
      "207-Bhosari",
      "208-Vadgaon Sheri",
      "209-Shivajinagar",
      "210-Kothrud",
      "211-Khadakwasala",
      "212-Parvati",
      "213-Hadapsar",
      "214-Pune Cantonment(SC)",
      "215-Kasba Peth",
      "216-Akole(ST)",
      "217-Sangmner",
      "218-Shirdi",
      "219-Kopargaon",
      "220-Shrirampur(SC)",
      "221-Nevasa",
      "222-Shevgaon",
      "223-Rahuri",
      "224-Parner",
      "225-Ahmednagar City",
      "226-Shrigonda",
      "227-Karjat Jamkhed",
      "228-Georai",
      "229-Majalgaon",
      "230-Beed",
      "231-Ashti",
      "232-Kaij(SC)",
      "233-Parli",
      "234-Latur Rural",
      "235-Latur City",
      "236-Ahmedpur",
      "237-Udgir(SC)",
      "238-Nilanga",
      "239-Ausa",
      "240-Omerga(SC)",
      "241-Tuljapur",
      "242-Dharashiv",
      "243-Paranda",
      "244-Karmala",
      "245-Madha",
      "246-Barshi",
      "247-Mohol(SC)",
      "248-solapur north",
      "249-solapur central",
      "250-Akkalkot",
      "251-Solapur South",
      "252-Pandharpur",
      "253-Sangola",
      "254-Malshiran(SC)",
      "255-Phaltan(SC)",
      "256-Wai",
      "257-koregaon",
      "258-Man",
      "259-Karad North",
      "260-Karad South",
      "261-patan",
      "262-Satara",
      "263-Dapoli",
      "264-Guhagar",
      "265-Chiplun",
      "266-Ratnagiri",
      "267-Rajapur",
      "268-Kankavli",
      "269-Kudal",
      "270-Sawantwadi",
      "271-Chandgad",
      "272-Radhanagari",
      "273-kagal",
      "274-Kolhapur South",
      "275-Karvir",
      "276-Kolhapur North",
      "277-Shahuwadi",
      "278-Hatkanangle(SC)",
      "279-Ichalkaranji",
      "280-Shirol",
      "281-Miraj(SC)",
      "282-Sangli",
      "283-islampur",
      "284-Shirala",
      "285-Palus-Kadegaon",
      "286-Khanpur",
      "287-Tasgaon-Kavathe",
      "288-Jat",
    ];

    const userConstituencyRoles = userRoles.filter((role) =>
      assemblyConstituencies.includes(role)
    );
    console.log("userConstituencyRoles::: ", userConstituencyRoles);

    // Define district roles
    const districtRoles = [
      "Ahmednagar",
      "Akola",
      "Washim",
      "Amravati",
      "Chhatrapati Sambhaji Nagar",
      "Pune",
      "Beed",
      "Bhandara",
      "Gondiya",
      "Thane",
      "Buldhana",
      "Chandrapur",
      "Yavatmal",
      "Dhule",
      "Nashik",
      "Gadchiroli",
      "Kolhapur",
      "Sangli",
      "Nanded",
      "Hingoli",
      "Jalgaon",
      "Jalna",
      "Latur",
      "Solapur",
      "Satara",
      "Raigad",
      "Mumbai (Suburban)",
      "Mumbai City",
      "Nagpur",
      "Nandurbar",
      "Dharashiv",
      "Palghar",
      "Parbhani",
      "Ratnagiri",
      "Sindhudurg",
      "Wardha",
    ];

    const userDistrictRoles = userRoles.filter((role) =>
      districtRoles.includes(role)
    );
    console.log("userDistrictRoles::: ", userDistrictRoles);

    if (userZoneRoles.length > 0) {
      if (userConstituencyRoles.length > 0) {
        if (userDistrictRoles.length > 0) {
          // Filter by zone, constituency, and district roles
          moms = await Mom.find({
            zone: { $in: userZoneRoles },
            constituency: { $in: userConstituencyRoles },
            district: { $in: userDistrictRoles },
          }).populate("userId");
        } else {
          // Filter by zone and constituency roles only
          moms = await Mom.find({
            zone: { $in: userZoneRoles },
            constituency: { $in: userConstituencyRoles },
          }).populate("userId");
        }
      } else if (userDistrictRoles.length > 0) {
        // Filter by zone and district roles only
        moms = await Mom.find({
          zone: { $in: userZoneRoles },
          district: { $in: userDistrictRoles },
        }).populate("userId");
      } else {
        // Filter by zone roles only
        moms = await Mom.find({
          zone: { $in: userZoneRoles },
        }).populate("userId");
      }
    } else if (userConstituencyRoles.length > 0) {
      if (userDistrictRoles.length > 0) {
        // Filter by constituency and district roles
        moms = await Mom.find({
          constituency: { $in: userConstituencyRoles },
          district: { $in: userDistrictRoles },
        }).populate("userId");
      } else {
        // Filter by constituency roles only
        moms = await Mom.find({
          constituency: { $in: userConstituencyRoles },
        }).populate("userId");
      }
    } else if (userDistrictRoles.length > 0) {
      // Filter by district roles only
      moms = await Mom.find({
        district: { $in: userDistrictRoles },
      }).populate("userId");
    } else {
      // Default to filtering by userId
      moms = await Mom.find({ userId }).populate("userId");
    }

    return res.status(200).json(moms);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-by-party/:partyName", async (req, res) => {
  try {
    const { partyName } = req.params;
    const moms = await Mom.find({ partyName }).populate("userId");

    const momCount = await Mom.countDocuments({ partyName });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-by-constituency/:constituency", async (req, res) => {
  try {
    const { constituency } = req.params;

    const moms = await Mom.find({ constituency }).populate("userId");

    const momCount = await Mom.countDocuments({ constituency });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.get("/get-mom-by-zone/:zone", async (req, res) => {
  try {
    const { zone } = req.params;

    const moms = await Mom.find({ zone }).populate("userId");

    const momCount = await Mom.countDocuments({ zone });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-count-by-zone/:zone", async (req, res) => {
  try {
    const { zone } = req.params;
    const momCount = await Mom.countDocuments({ zone });

    res.status(200).json({ zone, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-count-by-pc/:pc", async (req, res) => {
  try {
    const { pc } = req.params;
    const momCount = await Mom.countDocuments({ pc });

    res.status(200).json({ pc, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-count-by-constituency/:constituency", async (req, res) => {
  try {
    const { constituency } = req.params;
    const momCount = await Mom.countDocuments({ constituency });

    res.status(200).json({ constituency, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-by-pc/:pc", async (req, res) => {
  try {
    const { pc } = req.params;
    const moms = await Mom.find({ pc }).populate("userId");

    const momCount = moms.length;

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-all-moms-count", async (req, res) => {
  try {
    const { pc, constituency } = req.query;
    let moms;

    if (pc) {
      moms = await Mom.find({ pc }).populate("userId");
    } else if (constituency) {
      moms = await Mom.find({ constituency }).populate("userId");
    } else {
      moms = await Mom.find({});
    }
    const momCount = moms.length;
    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-mom/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const updatedMom = await Mom.findByIdAndUpdate(momId, req.body, {
      new: true,
    });
    res.status(200).json(updatedMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/delete-mom/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const deletedMom = await Mom.findByIdAndDelete(momId);
    if (!deletedMom) {
      return res.status(404).json({ error: "Mom record not found" });
    }
    res.status(200).json({ message: "Mom record deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
