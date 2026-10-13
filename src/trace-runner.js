import {TracePipeline} from './pipeline.js';

// At most one job runs and one latest job waits. Intermediate slider positions
// never build an unbounded worker queue. Buffers are copied only when changed.
export class TraceRunner {
  constructor(workerSource){this.workerSource=workerSource;this.sequence=0;this.epoch=0;this.waiters=[];this.pending=null;this.active=null;this.worker=null;this.workerURL=null;this.workerDisabled=false;}
  stopWorker(){this.worker?.terminate();this.worker=null;if(this.workerURL)URL.revokeObjectURL(this.workerURL);this.workerURL=null;}
  setSource(source){
    this.stopWorker();this.epoch++;this.source=source;this.sourceSent=false;this.sentEditRevision=-1;this.active=null;this.pending=null;
    for(const waiter of this.waiters)waiter.resolve(null);this.waiters=[];
    this.fallback=new TracePipeline();this.fallback.setSource(source);
  }
  request(options,edits,consumerMaskVersion){
    const id=++this.sequence;
    this.pending={id,options,edits,consumerMaskVersion};
    const promise=new Promise((resolve,reject)=>this.waiters.push({id,resolve,reject}));
    this.dispatch();return promise;
  }
  dispatch(){
    if(this.active || !this.pending)return;
    const job=this.pending;this.pending=null;this.active=job;
    if(!this.worker && !this.workerDisabled){
      let url;
      try{
        url=URL.createObjectURL(new Blob([this.workerSource],{type:'text/javascript'}));
        this.worker=new Worker(url);this.workerURL=url;const epoch=this.epoch;
        this.worker.onmessage=({data})=>{if(epoch===this.epoch)this.complete(data);};
        this.worker.onerror=event=>{event.preventDefault();if(epoch!==this.epoch)return;this.workerDisabled=true;this.stopWorker();this.runFallback();};
      }catch{this.workerDisabled=true;this.worker=null;if(url)URL.revokeObjectURL(url);}
    }
    if(!this.worker){this.runFallback();return;}
    const message={id:job.id,options:job.options,consumerMaskVersion:job.consumerMaskVersion},transfer=[];
    if(!this.sourceSent){const rgba=this.source.rgba.slice();message.source={...this.source,rgba};transfer.push(rgba.buffer);this.sourceSent=true;}
    if(job.options.editRevision!==this.sentEditRevision){message.edits=job.edits.slice();transfer.push(message.edits.buffer);this.sentEditRevision=job.options.editRevision;}
    try{this.worker.postMessage(message,transfer);}catch{this.workerDisabled=true;this.stopWorker();this.runFallback();}
  }
  runFallback(){
    const epoch=this.epoch,job=this.active;
    setTimeout(()=>{
      if(epoch!==this.epoch)return;
      try{this.complete({id:job.id,result:this.fallback.run(job.options,job.edits,job.consumerMaskVersion)});}
      catch(error){this.complete({id:job.id,error:error.message});}
    },0);
  }
  complete({id,result,error}){
    if(this.active?.id!==id)return;
    this.active=null;
    if(this.pending){this.dispatch();return;}
    const waiters=this.waiters;this.waiters=[];
    for(const waiter of waiters)error?waiter.reject(new Error(error)):waiter.resolve({...result,execution:this.worker?'worker':'fallback'});
  }
}
