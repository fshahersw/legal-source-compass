import {DocketBirdClient} from './docketbird-mcp-client.mjs';
const c=new DocketBirdClient('C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/docketbird/pdf-failure-probe-v1');
await c.initialize();
const result=await c.call('get_document',{document_id:'ohsd-2:2018-md-02846-00517'});
if(result.isError)throw Error('Provider metadata gap retained');
const data=result.structuredContent??JSON.parse(result.content.find(x=>x.type==='text').text);
const document=data.document??data;
console.log(JSON.stringify({responseKeys:Object.keys(data),documentKeys:Object.keys(document),nativeIdMatches:document.id==='ohsd-2:2018-md-02846-00517',restricted:document.restricted??null,downloaded:document.downloaded??null,hasPdfLocator:typeof document.pdf_url==='string'}));
