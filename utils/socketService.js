// utils/socketService.js
class SocketService {
  emit(event, payload) {
    try {
      const io = global.io;
      if (io) {
        io.emit(event, payload);
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  emitToRoom(room, event, payload) {
    try {
      const io = global.io;
      if (io) {
        io.to(room).emit(event, payload);
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  toRoom(room) {
    const io = global.io;
    if (!io) return null;
    return io.to(room);
  }
}

module.exports = new SocketService();
