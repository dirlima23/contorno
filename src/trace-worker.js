import {TracePipeline} from './pipeline.js';
const pipeline=new TracePipeline();
self.onmessage=({data})=>{
  try{
    if(data.source)pipeline.setSource(data.source);
    const result=pipeline.run(data.options,data.edits,data.consumerMaskVersion);
    self.postMessage({id:data.id,result},result.maskRGBA?[result.maskRGBA.buffer]:[]);
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
