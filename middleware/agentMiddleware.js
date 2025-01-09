const jwt = require('jsonwebtoken');
const User = require('../models/User');

const agentMiddleware = async (req, res, next) => {
    console.log('checking')
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    console.log(token, 'token')
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized access' });
    }
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decodedToken.userId);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized access' });
    }
    if (user.role !== 'agent') {
      return res.status(401).json({ message: 'Unauthorized access' });
    }
    if (req.params.agentId !== user._id.toString()) {
      return res.status(401).json({ message: 'Unauthorized access' });
    }
    next();
  } catch (err) {
    console.log(err, 'err')
    return res.status(401).json({ message: 'Unauthorized access' });
  }
};

module.exports = agentMiddleware;
