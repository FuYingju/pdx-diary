/**
 * 本地数据存储层
 * 负责把血压、体重、腹透超滤、用药、身体不适等记录，保存到手机浏览器自带的 IndexedDB 中。
 * 所有数据只存在本机，不联网、不上传。
 */

window.DB = (() => {
  const DB_NAME = 'pdx_diary';
  const DB_VERSION = 1;
  // 日期索引，用于按天读取记录
  const DATE_KEY = 'by_date';

  let _db = null;

  // 打开数据库，首次使用会创建表结构和索引
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        ['bp', 'weight', 'pd', 'symptom'].forEach((name) => {
          const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          store.createIndex(DATE_KEY, 'date', { unique: false });
        });
        // 用药清单无需按索引查询，单独创建
        db.createObjectStore('meds', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  // 获取数据库连接单例
  async function conn() {
    if (_db) return _db;
    return open();
  }

  // 写入一条记录
  async function add(store, obj) {
    const db = await conn();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).add(obj);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // 按 id 删除一条记录
  async function remove(store, id) {
    const db = await conn();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // 读取某个表的全部记录（按 id 升序）
  async function getAll(store) {
    const db = await conn();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // 读取某一天（date）的记录
  async function getByDate(store, date) {
    const db = await conn();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly')
        .objectStore(store).index(DATE_KEY).getAll(date);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  return { add, remove, getAll, getByDate };
})();