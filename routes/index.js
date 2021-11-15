const express = require('express');
const router = express.Router();
const fs = require('fs');

router.get('/fundraisinginitiatives', function(req, res) {
  res.contentType("application/pdf");
  const data = fs.readFileSync('./public/pdfs/fundraising_initiatives.pdf');
  res.send(data);
  res.end();
});

module.exports = router;
