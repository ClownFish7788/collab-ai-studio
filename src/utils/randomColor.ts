export function randomHexColor() {
  // 生成 0 ~ 16777215 的随机整数，转为16进制并补足6位
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}