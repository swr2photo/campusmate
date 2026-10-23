export function withTimeout(operation, milliseconds = 15000, message = 'การเชื่อมต่อใช้เวลานาน กรุณาลองอีกครั้ง') {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = 'operation-timeout';
        reject(error);
      }, milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
