const {createPool,initializeDatabase}=require('../server.cjs');
(async()=>{let pool;try{pool=createPool();await initializeDatabase(pool);console.log('Neon tables initialized.')}catch{console.error('Neon 초기화 실패: DATABASE_URL과 네트워크를 확인해주세요.');process.exitCode=1}finally{if(pool)await pool.end()}})();
