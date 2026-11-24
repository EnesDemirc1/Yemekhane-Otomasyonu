import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from './database.service';
import { RedisService } from './redis.service';

type UserSession = { id: number; ad: string; soyad: string; eposta: string; rol: string; bakiye: number };

@Controller()
export class ApiController {
  constructor(private readonly db: DatabaseService, private readonly redis: RedisService) {}

  private fail(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (typeof error === 'object' && error !== null && 'errno' in error && error.errno === 3819) {
      throw new HttpException({ message: 'İşlem doğrulanamadı.' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const message = error instanceof Error ? error.message : 'İşlem tamamlanamadı.';
    throw new HttpException({ message }, HttpStatus.BAD_REQUEST);
  }

  private async session(req: Request): Promise<{ token: string; user: UserSession }> {
    const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('yemekhane_oturum='))?.slice('yemekhane_oturum='.length);
    if (!token) throw new HttpException({ message: 'Oturum a?man?z gerekiyor.' }, 401);
    const saved = await this.redis.get(`oturum:${token}`);
    if (!saved) throw new HttpException({ message: 'Oturum s?reniz doldu.' }, 401);
    await this.redis.expire(`oturum:${token}`, 1800);
    return { token, user: JSON.parse(saved) as UserSession };
  }

  @Get('/')
  async health() { return { uygulama: 'Yemekhane API', durum: 'hazır' }; }

  @Post('/auth/giris')
  async login(@Body() body: { eposta: string; sifre: string }, @Res({ passthrough: true }) response: Response) {
    try {
      const users = await this.db.rows<any>('SELECT id, ad, soyad, eposta, sifre_hash, rol, bakiye FROM kullanicilar WHERE eposta = ? AND aktif = 1', [body.eposta]);
      const user = users[0];
      if (!user || !(await bcrypt.compare(body.sifre || '', user.sifre_hash))) throw new HttpException({ message: 'E-posta veya şifre hatalı.' }, 401);
      const token = randomBytes(32).toString('hex');
      const data: UserSession = { id: user.id, ad: user.ad, soyad: user.soyad, eposta: user.eposta, rol: user.rol, bakiye: user.bakiye };
      await this.redis.set(`oturum:${token}`, JSON.stringify(data), 1800);
      response.cookie('yemekhane_oturum', token, { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 1800000 });
      return { kullanici: data };
    } catch (error) { return this.fail(error); }
  }

  @Post('/auth/cikis')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('yemekhane_oturum='))?.slice('yemekhane_oturum='.length);
    if (token) await this.redis.del(`oturum:${token}`);
    response.clearCookie('yemekhane_oturum', { path: '/' });
    return { mesaj: 'Oturum kapatıldı.' };
  }

  @Get('/auth/me')
  async me(@Req() request: Request) { return (await this.session(request)).user; }

  @Get('/secenekler')
  async options() {
    const [halls, meals, allergens, dishes] = await Promise.all([
      this.db.rows<any>('SELECT id, ad, konum, kapasite FROM yemekhaneler ORDER BY id'),
      this.db.rows<any>('SELECT id, ad, sira FROM ogunler ORDER BY sira'),
      this.db.rows<any>('SELECT id, ad FROM alerjenler ORDER BY ad'),
      this.db.rows<any>('SELECT y.id, y.ad, y.kalori, y.vejetaryen, y.kategori_id, k.ad AS kategori, k.sira FROM yemekler y JOIN yemek_kategorileri k ON k.id = y.kategori_id ORDER BY k.sira, y.ad')
    ]);
    return { yemekhaneler: halls, ogunler: meals, alerjenler: allergens, yemekler: dishes };
  }

  @Get('/menu')
  async menu(@Req() request: Request, @Query('yemekhane') hall = '1', @Query('tarih') date?: string, @Query('ogun') meal?: string) {
    const { user } = await this.session(request);
    const selectedDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    const where = [Number(hall), selectedDate];
    let sql = 'SELECT d.*, f.kapasite, f.rezerve, f.bos_yer, f.doluluk_yuzde, p.oy_sayisi, p.ortalama_puan FROM v_menu_detay d JOIN v_menu_doluluk f ON f.menu_id = d.menu_id LEFT JOIN v_menu_puan p ON p.menu_id = d.menu_id WHERE d.yemekhane_id = ? AND d.tarih = ?';
    if (meal) { sql += ' AND d.ogun_id = ?'; where.push(Number(meal)); }
    sql += ' ORDER BY d.ogun_sira, d.kategori_sira, d.yemek';
    const expiry = Math.max(1, Math.floor((new Date(`${selectedDate}T23:59:59+03:00`).getTime() - Date.now()) / 1000));
    const rows = await this.cachedRows(`menu:${hall}:${selectedDate}:${meal || '*'}`, sql, where, expiry);
    const menus = new Map<number, any>();
    for (const row of rows) {
      if (!menus.has(row.menu_id)) menus.set(row.menu_id, { ...row, yemekler: [], toplam_kalori: 0, alerjen_uyarilari: [] });
      const menu = menus.get(row.menu_id);
      const dish = { id: row.yemek_id, ad: row.yemek, kategori: row.kategori, kalori: Number(row.kalori), vejetaryen: Boolean(row.vejetaryen), alerjenler: row.alerjenler ? String(row.alerjenler).split(', ') : [], uyarili: false };
      menu.yemekler.push(dish);
      menu.toplam_kalori += dish.kalori;
      if (dish.uyarili) menu.alerjen_uyarilari.push(dish.ad);
    }
    return { tarih: selectedDate, menuler: Array.from(menus.values()).map(menu => ({ ...menu, fiyat: user.rol === 'ogrenci' ? menu.ogrenci_fiyati : menu.personel_fiyati })) };
  }


  private async cachedRows(key: string, sql: string, values: unknown[], seconds: number) {
    const cached = await this.redis.get(key);
    if (cached) {
      console.info(`menu-cache hit ${key}`);
      return JSON.parse(cached);
    }
    const rows = await this.db.rows<any>(sql, values);
    await this.redis.set(key, JSON.stringify(rows), seconds);
    console.info(`menu-cache miss ${key}`);
    return rows;
  }

  @Post('/rezervasyonlar')
  async reserve(@Req() request: Request, @Body() body: { menu_id: number }) {
    const { user } = await this.session(request);
    try {
      const [result] = await this.db.write.query<any[]>('CALL sp_rezervasyon_yap(?, ?)', [user.id, body.menu_id]);
      const [live] = await this.db.write.query<any[]>('SELECT bakiye FROM kullanicilar WHERE id = ?', [user.id]);
      await this.redis.deletePattern('menu:*');
      return { ...(result[0]?.[0] || {}), bakiye: Number(live[0]?.bakiye) };
    } catch (error) { return this.fail(error); }
  }

  @Get('/rezervasyonlar')
  async reservations(@Req() request: Request) {
    const { user } = await this.session(request);
    return this.db.rows<any>(`SELECT r.id AS rezervasyon_id, r.menu_id, r.durum, r.ucret, r.olusturma, m.tarih, yh.ad AS yemekhane, o.ad AS ogun, TIMESTAMP(m.tarih, o.son_saat) AS rezervasyon_son, TIMESTAMP(m.tarih, o.servis_baslangic) AS servis_baslangic FROM rezervasyonlar r JOIN menuler m ON m.id = r.menu_id JOIN yemekhaneler yh ON yh.id = m.yemekhane_id JOIN ogunler o ON o.id = m.ogun_id WHERE r.kullanici_id = ? ORDER BY m.tarih DESC, o.sira`, [user.id]);
  }

  @Post('/rezervasyonlar/:id/iptal')
  async cancel(@Req() request: Request, @Param('id') id: string) {
    const { user } = await this.session(request);
    try {
      const [result] = await this.db.write.query<any[]>('CALL sp_rezervasyon_iptal(?, ?)', [user.id, Number(id)]);
      const [fresh] = await this.db.write.query<any[]>('SELECT bakiye FROM kullanicilar WHERE id = ?', [user.id]);
      await this.redis.deletePattern('menu:*');
      return { ...(result[0]?.[0] || {}), bakiye: Number(fresh[0]?.bakiye) };
    } catch (error) { return this.fail(error); }
  }

  @Get('/bakiye')
  async balance(@Req() request: Request) {
    const { user } = await this.session(request);
    const [profile, history] = await Promise.all([
      this.db.write.query<any[]>('SELECT bakiye FROM kullanicilar WHERE id = ?', [user.id]),
      this.db.rows<any>('SELECT id, tur, tutar, rezervasyon_id, aciklama, olusturma FROM bakiye_hareketleri WHERE kullanici_id = ? ORDER BY olusturma DESC LIMIT 100', [user.id])
    ]);
    return { bakiye: Number(profile[0][0]?.bakiye || 0), hareketler: history };
  }

  @Post('/bakiye/yukle')
  async topUp(@Req() request: Request, @Body() body: { tutar: number }) {
    const { user } = await this.session(request);
    try {
      const [result] = await this.db.write.query<any[]>('CALL sp_bakiye_yukle(?, ?)', [user.id, body.tutar]);
      const [fresh] = await this.db.write.query<any[]>('SELECT bakiye FROM kullanicilar WHERE id = ?', [user.id]);
      await this.redis.deletePattern('menu:*');
      return { ...(result[0]?.[0] || {}), bakiye: Number(fresh[0]?.bakiye) };
    } catch (error) { return this.fail(error); }
  }

  @Get('/degerlendirmeler')
  async reviewable(@Req() request: Request) {
    const { user } = await this.session(request);
    return this.db.rows<any>(`SELECT m.id AS menu_id, m.tarih, yh.ad AS yemekhane, o.ad AS ogun, d.puan, d.yorum, d.olusturma AS degerlendirme_tarihi FROM rezervasyonlar r JOIN menuler m ON m.id = r.menu_id JOIN yemekhaneler yh ON yh.id = m.yemekhane_id JOIN ogunler o ON o.id = m.ogun_id LEFT JOIN degerlendirmeler d ON d.menu_id = m.id AND d.kullanici_id = r.kullanici_id WHERE r.kullanici_id = ? AND r.durum = 'kullanildi' ORDER BY m.tarih DESC`, [user.id]);
  }

  @Post('/degerlendirmeler')
  async review(@Req() request: Request, @Body() body: { menu_id: number; puan: number; yorum?: string }) {
    const { user } = await this.session(request);
    if (body.puan < 1 || body.puan > 5) throw new HttpException({ message: 'Puan 1 ile 5 arasında olmalıdır.' }, 400);
    const eligible = await this.db.rows<any>(`SELECT id FROM rezervasyonlar WHERE kullanici_id = ? AND menu_id = ? AND durum = 'kullanildi'`, [user.id, body.menu_id]);
    if (!eligible.length) throw new HttpException({ message: 'Yalnızca kullanılmış menüler değerlendirilebilir.' }, 400);
    try {
      await this.db.write.query('INSERT INTO degerlendirmeler (kullanici_id, menu_id, puan, yorum) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE puan = VALUES(puan), yorum = VALUES(yorum), olusturma = NOW()', [user.id, body.menu_id, body.puan, body.yorum || null]);
      return { mesaj: 'Değerlendirmeniz kaydedildi.' };
    } catch (error) { return this.fail(error); }
  }

  @Get('/yonetim/menuler')
  async adminMenus(@Req() request: Request) {
    const { user } = await this.session(request);
    this.requireAdmin(user);
    return this.db.rows<any>(`SELECT f.*, p.oy_sayisi, p.ortalama_puan, m.ogrenci_fiyati, m.personel_fiyati FROM v_menu_doluluk f JOIN menuler m ON m.id = f.menu_id LEFT JOIN v_menu_puan p ON p.menu_id = f.menu_id ORDER BY f.tarih DESC, f.ogun_id`);
  }

  @Post('/yonetim/menuler')
  async createMenu(@Req() request: Request, @Body() body: { yemekhane_id: number; tarih: string; ogun_id: number; ogrenci_fiyati: number; personel_fiyati: number; yemekler: number[] }) {
    const { user } = await this.session(request);
    this.requireAdmin(user);
    const connection = await this.db.write.getConnection();
    try {
      await connection.beginTransaction();
      const [inserted] = await connection.query<any>('INSERT INTO menuler (yemekhane_id, tarih, ogun_id, ogrenci_fiyati, personel_fiyati) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE ogrenci_fiyati = VALUES(ogrenci_fiyati), personel_fiyati = VALUES(personel_fiyati), id = LAST_INSERT_ID(id)', [body.yemekhane_id, body.tarih, body.ogun_id, body.ogrenci_fiyati, body.personel_fiyati]);
      const menuId = inserted.insertId;
      await connection.query('DELETE FROM menu_yemekleri WHERE menu_id = ?', [menuId]);
      for (const dishId of [...new Set(body.yemekler || [])]) await connection.query('INSERT INTO menu_yemekleri (menu_id, yemek_id) VALUES (?, ?)', [menuId, dishId]);
      await connection.commit();
      return { menu_id: menuId, mesaj: 'Menü kaydedildi.' };
    } catch (error) { await connection.rollback(); return this.fail(error); }
    finally { connection.release(); }
  }

  @Post('/turnike')
  async turnstile(@Req() request: Request, @Body() body: { yemekhane_id: number; zaman?: string }) {
    const { user } = await this.session(request);
    try {
      const [result] = await this.db.write.query<any[]>('CALL sp_turnike_gecis(?, ?, ?)', [user.id, body.yemekhane_id, body.zaman || null]);
      return result[0]?.[0] || { mesaj: 'Geçiş kaydedildi.' };
    } catch (error) { return this.fail(error); }
  }

  private requireAdmin(user: UserSession) {
    if (user.rol !== 'yonetici') throw new HttpException({ message: 'Bu işlem için yönetici yetkisi gerekir.' }, 403);
  }
}
