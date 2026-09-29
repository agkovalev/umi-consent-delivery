import { Store } from './store.js';
import { buildApp } from './app.js';
const store=new Store(process.env.DELIVERY_DATA ?? '.local/service');
const app=buildApp(store,true);
await app.listen({host:process.env.HOST ?? '127.0.0.1',port:Number(process.env.PORT ?? 3100)});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();store.close();process.exit(0);});
