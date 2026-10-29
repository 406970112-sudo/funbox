const QRCode = require("../libs/qrcode/index");

function drawScoreQRCode(page, canvasId, content, size) {
  const qr = new QRCode(0, QRCode.QRErrorCorrectLevel.M);
  qr.addData(content);
  qr.make();
  const count = qr.getModuleCount();
  const quietZone = 4;
  const cellSize = size / (count + quietZone * 2);
  const context = wx.createCanvasContext(canvasId, page);
  context.setFillStyle("#ffffff");
  context.fillRect(0, 0, size, size);
  context.setFillStyle("#16221d");
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) {
        context.fillRect(
          Math.round((column + quietZone) * cellSize),
          Math.round((row + quietZone) * cellSize),
          Math.ceil(cellSize),
          Math.ceil(cellSize)
        );
      }
    }
  }
  context.draw();
}

module.exports = {
  drawScoreQRCode,
};
