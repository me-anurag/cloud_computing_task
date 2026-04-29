const request = require('supertest');
const app = require('../src/server');

describe('Image Upload Server', () => {
  test('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  test('POST /upload without file returns 400', async () => {
    const res = await request(app).post('/upload');
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /upload with non-image file returns 400', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('image', Buffer.from('not an image'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });
    expect(res.statusCode).toBe(400);
  });
});
