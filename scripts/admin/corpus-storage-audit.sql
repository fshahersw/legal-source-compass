-- READ-ONLY storage and database-size audit for project xosqzzsnhxcyehcnirpa.
-- Run statements independently in the Supabase SQL editor using the intended
-- project's admin connection. This file contains SELECTs only; it creates no
-- objects and changes no rows. Do not treat an unreferenced key as deletable.
--
-- Storage reference inventory is deliberately explicit and versioned against:
--   corpus_ingest.pdf_objects / pdf_backfill_captures
--   public.corpus_artifacts
--   src/lib/private-data/manifest.server.json (324 exact manifest entries)
--   legal_atlas.original_archives and legal_atlas.records/staging/mdl_packets
-- PDF asset/occurrence ledgers point to pdf_objects; those associations are
-- summarized separately below. Legal archive chunk keys inside uploaded
-- manifest bodies are opaque to SQL and require a separate read-only manifest
-- fetch/parse before any key can be considered unreferenced.

-- 0. Schema inventory: find new explicit storage-reference columns before
-- trusting the explicit key list below. This reads catalog metadata only.
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema IN ('public','corpus_ingest','legal_atlas')
  AND column_name ~* '(object|storage|manifest|capture|bucket).*(key|path)|(key|path).*(object|storage|manifest|capture|bucket)'
ORDER BY table_schema, table_name, ordinal_position;

-- 1. Storage inventory and registered reference reconciliation. The first
-- result set is bucket totals. The second set compares every known exact key
-- reference with storage.objects and reports only review candidates. Bundle
-- values below were generated from manifest.server.json and preserve repeated
-- file entries that intentionally share one hash-addressed object.
WITH private_bundle_manifest(file_name, sha256, bytes, object_key) AS (
  VALUES
  /* PRIVATE_BUNDLE_MANIFEST_BEGIN */
  ('atlas-import-bundle.json','acb1355f66463d76e865e582a2a3cc3e62a235fe0ffa19eb69ea80fb3e7b7b3e',6539722,'atlas-private-data/sha256/ac/acb1355f66463d76e865e582a2a3cc3e62a235fe0ffa19eb69ea80fb3e7b7b3e.bin'),
  ('catalog-matters.json','2c1b0938a58a8d66ae576452aa19d249e0c7d043cc8a91aeac202dbd48e23eec',1199463,'atlas-private-data/sha256/2c/2c1b0938a58a8d66ae576452aa19d249e0c7d043cc8a91aeac202dbd48e23eec.bin'),
  ('catalog/ak.json','29c69d70781eb72de999ba566fb927a47b63bf373b7a1fc41f1cfeb60401d5f3',77872,'atlas-private-data/sha256/29/29c69d70781eb72de999ba566fb927a47b63bf373b7a1fc41f1cfeb60401d5f3.bin'),
  ('catalog/al.json','7a525436a8f613d422b48666900527ff03cdfbf868064e5b4500867d402d38f4',74419,'atlas-private-data/sha256/7a/7a525436a8f613d422b48666900527ff03cdfbf868064e5b4500867d402d38f4.bin'),
  ('catalog/ar.json','79e4336f41f4f47115c14dc12898259542c5152da8bcebdd957a04c8c63af11e',58166,'atlas-private-data/sha256/79/79e4336f41f4f47115c14dc12898259542c5152da8bcebdd957a04c8c63af11e.bin'),
  ('catalog/az.json','a4b04197b2e759cec3eaf9cde01f793b5fbf621a72981e57461c1a5fe9a77770',120135,'atlas-private-data/sha256/a4/a4b04197b2e759cec3eaf9cde01f793b5fbf621a72981e57461c1a5fe9a77770.bin'),
  ('catalog/ca.json','28a463157a880d2345b70a6cf8677e0416ea5b50ad440000f4aa6e52341b9c45',230355,'atlas-private-data/sha256/28/28a463157a880d2345b70a6cf8677e0416ea5b50ad440000f4aa6e52341b9c45.bin'),
  ('catalog/co.json','15eb2a69ee9260bb031c9a33a6eaca8034411cbaba02788413f31bd5a57bd931',59847,'atlas-private-data/sha256/15/15eb2a69ee9260bb031c9a33a6eaca8034411cbaba02788413f31bd5a57bd931.bin'),
  ('catalog/ct.json','36d3003d930aaae2f2ef0d529125d42be14d4cd97330ff42f1c0ae9d5172750e',60225,'atlas-private-data/sha256/36/36d3003d930aaae2f2ef0d529125d42be14d4cd97330ff42f1c0ae9d5172750e.bin'),
  ('catalog/dc.json','69e28d545f8df84621cc23217d67efbd32d82b84d5262be2f7bbed60bad3fd59',75179,'atlas-private-data/sha256/69/69e28d545f8df84621cc23217d67efbd32d82b84d5262be2f7bbed60bad3fd59.bin'),
  ('catalog/de.json','125720239ba624693bc6a697e2fb7b4a8e16a1b288cd52129cffb0afa21c00db',116523,'atlas-private-data/sha256/12/125720239ba624693bc6a697e2fb7b4a8e16a1b288cd52129cffb0afa21c00db.bin'),
  ('catalog/fl.json','2166c769d32c545c17dfd9139daf788288be83e4961abad1708cbedf4d81df04',66509,'atlas-private-data/sha256/21/2166c769d32c545c17dfd9139daf788288be83e4961abad1708cbedf4d81df04.bin'),
  ('catalog/ga.json','146a6120ae00034662ffbec8f4cd11fc2ff0198a9878111240df440768f5af3f',54031,'atlas-private-data/sha256/14/146a6120ae00034662ffbec8f4cd11fc2ff0198a9878111240df440768f5af3f.bin'),
  ('catalog/hi.json','5ae6d3d646232e21bfa5e9d709ea881896f3ae4672bd96243df573d51086f827',44043,'atlas-private-data/sha256/5a/5ae6d3d646232e21bfa5e9d709ea881896f3ae4672bd96243df573d51086f827.bin'),
  ('catalog/ia.json','cb2330b47991b64b995f1dec1b691a46e56c633a52962e448b8ab76110dcd65c',57032,'atlas-private-data/sha256/cb/cb2330b47991b64b995f1dec1b691a46e56c633a52962e448b8ab76110dcd65c.bin'),
  ('catalog/id.json','5c4a223fceefa5be0ceb5519f1f6310d0a9e4868d2a55942e134ecc5fe854e83',51212,'atlas-private-data/sha256/5c/5c4a223fceefa5be0ceb5519f1f6310d0a9e4868d2a55942e134ecc5fe854e83.bin'),
  ('catalog/il.json','0c16e806225404f190f9cedd2393f472bf1a941e50b8e2962c62b9e7231ac974',64924,'atlas-private-data/sha256/0c/0c16e806225404f190f9cedd2393f472bf1a941e50b8e2962c62b9e7231ac974.bin'),
  ('catalog/in.json','a194eeaaea82fd2ff0ae3b23323f4d8aaec8f381b60e52b30df6adafe6adad17',96906,'atlas-private-data/sha256/a1/a194eeaaea82fd2ff0ae3b23323f4d8aaec8f381b60e52b30df6adafe6adad17.bin'),
  ('catalog/index.json','5640c1ad3dedbd3494de8349d1df68a4286f9956a9b8acea4e094a0aa612c24d',4294,'atlas-private-data/sha256/56/5640c1ad3dedbd3494de8349d1df68a4286f9956a9b8acea4e094a0aa612c24d.bin'),
  ('catalog/ks.json','bf18b61b76fa9cb84593d221b33916a955db5c2e1805e33bc8777ecfac1cedfe',48293,'atlas-private-data/sha256/bf/bf18b61b76fa9cb84593d221b33916a955db5c2e1805e33bc8777ecfac1cedfe.bin'),
  ('catalog/ky.json','f24bcf8287f14a1cfad451fe77fa621a2933a5e22e11ed9c3bce70b31c794ee9',84463,'atlas-private-data/sha256/f2/f24bcf8287f14a1cfad451fe77fa621a2933a5e22e11ed9c3bce70b31c794ee9.bin'),
  ('catalog/la.json','9769f45447a4bc4a7dc996a05fcd774bd9fea69af35e23f186c3f475defb0406',46840,'atlas-private-data/sha256/97/9769f45447a4bc4a7dc996a05fcd774bd9fea69af35e23f186c3f475defb0406.bin'),
  ('catalog/ma.json','1c84ad44e27634d569027218f716ea8474fb7068eebfd53d2ae29ac934f44149',91454,'atlas-private-data/sha256/1c/1c84ad44e27634d569027218f716ea8474fb7068eebfd53d2ae29ac934f44149.bin'),
  ('catalog/md.json','d7576c25fc0d593b6805cecf338f43f8b849cdc691853ccf2ef85a08ee8fa742',61716,'atlas-private-data/sha256/d7/d7576c25fc0d593b6805cecf338f43f8b849cdc691853ccf2ef85a08ee8fa742.bin'),
  ('catalog/me.json','2ac08ba754411269e82b47b6c28c23740e9a3df96009ba6620fea5b52e7f91cc',62977,'atlas-private-data/sha256/2a/2ac08ba754411269e82b47b6c28c23740e9a3df96009ba6620fea5b52e7f91cc.bin'),
  ('catalog/mi.json','abea0e6a89f4586c81e7e9d115d311246fad7cfb247e24c2de4c105d3bff82c7',46500,'atlas-private-data/sha256/ab/abea0e6a89f4586c81e7e9d115d311246fad7cfb247e24c2de4c105d3bff82c7.bin'),
  ('catalog/mn.json','cc5edde98f9865c199348191f00a8a01c27c1a9ba59246c8ff89a591dc9b41c1',243354,'atlas-private-data/sha256/cc/cc5edde98f9865c199348191f00a8a01c27c1a9ba59246c8ff89a591dc9b41c1.bin'),
  ('catalog/mo.json','8680664ff964847733db8f850c20f99d6455d042f48996e3415a2a1c523eba55',88633,'atlas-private-data/sha256/86/8680664ff964847733db8f850c20f99d6455d042f48996e3415a2a1c523eba55.bin'),
  ('catalog/ms.json','cf06329ce75f9dc7b780d78f4006213592d329b16c70955d1bd1840103373be8',44106,'atlas-private-data/sha256/cf/cf06329ce75f9dc7b780d78f4006213592d329b16c70955d1bd1840103373be8.bin'),
  ('catalog/mt.json','985ca43e1846b3f49f8233e346379df59d5257154cf0d22c3f30344c2ed6ad47',73118,'atlas-private-data/sha256/98/985ca43e1846b3f49f8233e346379df59d5257154cf0d22c3f30344c2ed6ad47.bin'),
  ('catalog/multi.json','12f9578a2045f73c8dcd57495d5c9f70a2f4657134f05c2fc68753e186a1d58c',236255,'atlas-private-data/sha256/12/12f9578a2045f73c8dcd57495d5c9f70a2f4657134f05c2fc68753e186a1d58c.bin'),
  ('catalog/nc.json','57263917ce6cf1c80861d95387a69b4cc404706bc7017753e2b058a51b6211c4',57776,'atlas-private-data/sha256/57/57263917ce6cf1c80861d95387a69b4cc404706bc7017753e2b058a51b6211c4.bin'),
  ('catalog/nd.json','e8e4ae0c67574ee8a7d7e882f1294efdc9c62ab396f087039552d921f0a482f3',42434,'atlas-private-data/sha256/e8/e8e4ae0c67574ee8a7d7e882f1294efdc9c62ab396f087039552d921f0a482f3.bin'),
  ('catalog/ne.json','fdf74790749fc88aef90ac6d8f135bf73e3a788762c2816f8cc30dd4b4f470d5',64184,'atlas-private-data/sha256/fd/fdf74790749fc88aef90ac6d8f135bf73e3a788762c2816f8cc30dd4b4f470d5.bin'),
  ('catalog/nh.json','c301fca78e65f8627f466f5a7504ae60d4541b30cfe09c93c33c322c2a60dd9d',92829,'atlas-private-data/sha256/c3/c301fca78e65f8627f466f5a7504ae60d4541b30cfe09c93c33c322c2a60dd9d.bin'),
  ('catalog/nj.json','1b04b46b64ccffe418967417d056834ee24d2d9d7de749ed11ca68b7e78a348b',91205,'atlas-private-data/sha256/1b/1b04b46b64ccffe418967417d056834ee24d2d9d7de749ed11ca68b7e78a348b.bin'),
  ('catalog/nm.json','db7c52e6f4b5c6af7e21167cf2e7121452429a815c1d72849c8a6dbfe4fe1bce',53501,'atlas-private-data/sha256/db/db7c52e6f4b5c6af7e21167cf2e7121452429a815c1d72849c8a6dbfe4fe1bce.bin'),
  ('catalog/nv.json','f9e8f8c489121192e0f40e421c65a29441eaea29314e30b2ed944a78716428b7',40828,'atlas-private-data/sha256/f9/f9e8f8c489121192e0f40e421c65a29441eaea29314e30b2ed944a78716428b7.bin'),
  ('catalog/ny.json','a50b03bd31a39f8a9334e1ed8479a50737c234e4aafc5b5bd5247c9323c64b85',143222,'atlas-private-data/sha256/a5/a50b03bd31a39f8a9334e1ed8479a50737c234e4aafc5b5bd5247c9323c64b85.bin'),
  ('catalog/oh.json','cbb2c41906137d8a14e1fcf38494951ee7e3fb26d5da22afa8801572a3b2c889',143980,'atlas-private-data/sha256/cb/cbb2c41906137d8a14e1fcf38494951ee7e3fb26d5da22afa8801572a3b2c889.bin'),
  ('catalog/ok.json','bb1c8ac44e28891425ec32638c651cdb1a648078c1432860adbfe2af63fff1eb',60693,'atlas-private-data/sha256/bb/bb1c8ac44e28891425ec32638c651cdb1a648078c1432860adbfe2af63fff1eb.bin'),
  ('catalog/or.json','da636247ca2072af394bcdedb5629465185b4c24ae72ae8dec4d0f1119b69061',115479,'atlas-private-data/sha256/da/da636247ca2072af394bcdedb5629465185b4c24ae72ae8dec4d0f1119b69061.bin'),
  ('catalog/pa.json','e2092d98ff8e069a39676a64975b09a4e50ad67c09e9960710e6f4994b785390',78074,'atlas-private-data/sha256/e2/e2092d98ff8e069a39676a64975b09a4e50ad67c09e9960710e6f4994b785390.bin'),
  ('catalog/pr.json','aea3610fdec76ce3fc5f907cf29f8beb48019e9c569854263567aa97b0cbbad4',1144,'atlas-private-data/sha256/ae/aea3610fdec76ce3fc5f907cf29f8beb48019e9c569854263567aa97b0cbbad4.bin'),
  ('catalog/ri.json','0ee609f80cfcabace9588eec23c75a6c2df8c0eacfd1d95709fa959bd68e6304',49185,'atlas-private-data/sha256/0e/0ee609f80cfcabace9588eec23c75a6c2df8c0eacfd1d95709fa959bd68e6304.bin'),
  ('catalog/sc.json','21f31e8cb253e78e3c88481bcdedd56636655c657107b7f27a2494e7e10a7dbe',64988,'atlas-private-data/sha256/21/21f31e8cb253e78e3c88481bcdedd56636655c657107b7f27a2494e7e10a7dbe.bin'),
  ('catalog/sd.json','22796495240547dd23d60841a1ee910cdc92b7cdc894d2475fb8444900549f90',125242,'atlas-private-data/sha256/22/22796495240547dd23d60841a1ee910cdc92b7cdc894d2475fb8444900549f90.bin'),
  ('catalog/tn.json','f7c1c16b82eb5c0afbba66584138eab28658c31c76800e3dd4f2e13f5316c48c',190713,'atlas-private-data/sha256/f7/f7c1c16b82eb5c0afbba66584138eab28658c31c76800e3dd4f2e13f5316c48c.bin'),
  ('catalog/tx.json','948e7c711199b0f9e497c7b731cc956d66cd741a5850c54d9ecc02ed6b7d4eaa',90581,'atlas-private-data/sha256/94/948e7c711199b0f9e497c7b731cc956d66cd741a5850c54d9ecc02ed6b7d4eaa.bin'),
  ('catalog/us.json','b8cf6669ba3c3d29a8afb5402f659ebe08813ff08e6e842ad94ce1ad36a5c06c',1481126,'atlas-private-data/sha256/b8/b8cf6669ba3c3d29a8afb5402f659ebe08813ff08e6e842ad94ce1ad36a5c06c.bin'),
  ('catalog/ut.json','a282a308a9b4de3c89ce92458ab00b45e9cd1b7caba26afa62ddc554b68aa50d',50054,'atlas-private-data/sha256/a2/a282a308a9b4de3c89ce92458ab00b45e9cd1b7caba26afa62ddc554b68aa50d.bin'),
  ('catalog/va.json','2e1e8302b0bf29940a667405cea61b4fe043c5ccb1cb42d8148e49c74ea371fc',70121,'atlas-private-data/sha256/2e/2e1e8302b0bf29940a667405cea61b4fe043c5ccb1cb42d8148e49c74ea371fc.bin'),
  ('catalog/vi.json','f5d8b2c71111c4c7a6ad07c1a6b86f56a2623cea94e59aae6a37492d02ac1160',2085,'atlas-private-data/sha256/f5/f5d8b2c71111c4c7a6ad07c1a6b86f56a2623cea94e59aae6a37492d02ac1160.bin'),
  ('catalog/vt.json','bb2fbbf8ef5f4a142605f5f09748897ab83656c6472dbe5d74c627ae832d3f48',92889,'atlas-private-data/sha256/bb/bb2fbbf8ef5f4a142605f5f09748897ab83656c6472dbe5d74c627ae832d3f48.bin'),
  ('catalog/wa.json','d89317ddf8cbb24c3f24f440971a273e3d2c5c4a6415e77da7692b2a7f1a1e2a',116079,'atlas-private-data/sha256/d8/d89317ddf8cbb24c3f24f440971a273e3d2c5c4a6415e77da7692b2a7f1a1e2a.bin'),
  ('catalog/wi.json','035852500247e2e66edda680beb2d7dd6ca9cae9244c758e0874df01870cee02',70380,'atlas-private-data/sha256/03/035852500247e2e66edda680beb2d7dd6ca9cae9244c758e0874df01870cee02.bin'),
  ('catalog/wv.json','bbf068a4f1db17b763ba2b0911c6cc632da10d7d5073cb290c0c77ccb39773bd',103551,'atlas-private-data/sha256/bb/bbf068a4f1db17b763ba2b0911c6cc632da10d7d5073cb290c0c77ccb39773bd.bin'),
  ('catalog/wy.json','5a559551178e80be1deaf613f223b2f518a2790fae8c7b603166355236e3f1f4',56773,'atlas-private-data/sha256/5a/5a559551178e80be1deaf613f223b2f518a2790fae8c7b603166355236e3f1f4.bin'),
  ('corpus/PROVENANCE.json','b86ab2e6b439840eb22fe02b8a57552e3c967cc78254cf5e678fbe304e1f6063',1116,'atlas-private-data/sha256/b8/b86ab2e6b439840eb22fe02b8a57552e3c967cc78254cf5e678fbe304e1f6063.bin'),
  ('corpus/insights.json','c77635eb16be3c170d19dbd1320fa6c4484baf0556649115c3fa6ff77cea5301',578721,'atlas-private-data/sha256/c7/c77635eb16be3c170d19dbd1320fa6c4484baf0556649115c3fa6ff77cea5301.bin'),
  ('corpus/us-counties-albers-10m.json','a674dfa31b625e92635f32684a61ae135b05a91507f17f2d5164833237fecf46',795405,'atlas-private-data/sha256/a6/a674dfa31b625e92635f32684a61ae135b05a91507f17f2d5164833237fecf46.bin'),
  ('limitations/case-references.json','65a00e341fc341e4e50e41c2de34b632e0cf791f569017c695e6da143f92b6e2',26954,'atlas-private-data/sha256/65/65a00e341fc341e4e50e41c2de34b632e0cf791f569017c695e6da143f92b6e2.bin'),
  ('limitations/coverage.json','10c0aa5763d119355de8079343f9e6ece6c280c1fb28948c802c1b2aa19cf2df',94297,'atlas-private-data/sha256/10/10c0aa5763d119355de8079343f9e6ece6c280c1fb28948c802c1b2aa19cf2df.bin'),
  ('limitations/followup/access-retry-20261002-v4.json','728547d0b0fccd652b71788b90e6ffd4040c7efe3d303ae3668945dff9e33736',16325,'atlas-private-data/sha256/72/728547d0b0fccd652b71788b90e6ffd4040c7efe3d303ae3668945dff9e33736.bin'),
  ('limitations/followup/acquisition-audit-20261002-v2.json','da197638125da349c75b84fc0f68463853355675cd1d5f870a9af0892da72719',9172,'atlas-private-data/sha256/da/da197638125da349c75b84fc0f68463853355675cd1d5f870a9af0892da72719.bin'),
  ('limitations/followup/nd-28-01-api.json','1bdd2968497431dc6570934a657623b108d132af1dd4d57ac3115161e48c92eb',74633,'atlas-private-data/sha256/1b/1bdd2968497431dc6570934a657623b108d132af1dd4d57ac3115161e48c92eb.bin'),
  ('limitations/followup/nd-28-01.3-api.json','bb7372cf5a3a6f21644a31e39c9e18234a64073fd96852a0f6d06705a08a0933',24794,'atlas-private-data/sha256/bb/bb7372cf5a3a6f21644a31e39c9e18234a64073fd96852a0f6d06705a08a0933.bin'),
  ('limitations/followup/nd-32-21-api.json','644fd47005cfd504997df6f947edacbdd567d40cbd1961957ba8d9db2a40d5c0',6301,'atlas-private-data/sha256/64/644fd47005cfd504997df6f947edacbdd567d40cbd1961957ba8d9db2a40d5c0.bin'),
  ('limitations/followup/nd-dickie-2000-capture.json','4505816a531306e1854e21d9d86711dc34309500b9f09d31d138afefc69fe865',19768,'atlas-private-data/sha256/45/4505816a531306e1854e21d9d86711dc34309500b9f09d31d138afefc69fe865.bin'),
  ('limitations/followup/nm-ch37-fragment0-capture.json','5895b9c32d8e925d6b6b015a9e30963089d53d4de2e325276fc7db5dfcd20a88',25779,'atlas-private-data/sha256/58/5895b9c32d8e925d6b6b015a9e30963089d53d4de2e325276fc7db5dfcd20a88.bin'),
  ('limitations/followup/nm-ch41-fragment0-capture.json','08a9b9f293d465a69fb38b4cd737b69d30b4b24cbc15a6718eb2421320373632',18973,'atlas-private-data/sha256/08/08a9b9f293d465a69fb38b4cd737b69d30b4b24cbc15a6718eb2421320373632.bin'),
  ('limitations/followup/ok-12-1053-capture.json','2d70751750ec9357e6b224665da779ebfb6f0c2d0969f7bb795997abdbc9db90',10139,'atlas-private-data/sha256/2d/2d70751750ec9357e6b224665da779ebfb6f0c2d0969f7bb795997abdbc9db90.bin'),
  ('limitations/followup/ok-12-95-capture.json','243940fc5030953af2dabe6ecd58858b0955f6567598bea41e041264a77b0b4d',8613,'atlas-private-data/sha256/24/243940fc5030953af2dabe6ecd58858b0955f6567598bea41e041264a77b0b4d.bin'),
  ('limitations/followup/ok-12-96-capture.json','1198b32d02df2c9c0196eebd6c70de03ac319915a23abaaf8502388876fe9bee',4455,'atlas-private-data/sha256/11/1198b32d02df2c9c0196eebd6c70de03ac319915a23abaaf8502388876fe9bee.bin'),
  ('limitations/followup/research-authorities-20261002-v3.json','08c8a78a84afe1fc889202aaa40b9b97ec47004f7490c687edad0b563994b766',65404,'atlas-private-data/sha256/08/08c8a78a84afe1fc889202aaa40b9b97ec47004f7490c687edad0b563994b766.bin'),
  ('limitations/followup/review-findings-20261002-v2.json','912d31231713a28aecafc54493707ff00d77c957f077eaaeb8fa9e2688675282',901,'atlas-private-data/sha256/91/912d31231713a28aecafc54493707ff00d77c957f077eaaeb8fa9e2688675282.bin'),
  ('limitations/opinion-text/az-hazine-1993.txt','e431ec10a6a4adf837c71a7377c01babe1686228419cdeafa685ce7e47746c97',32274,'atlas-private-data/sha256/e4/e431ec10a6a4adf837c71a7377c01babe1686228419cdeafa685ce7e47746c97.bin'),
  ('limitations/opinion-text/ca-fox-2005.txt','93f6308ea99aac076bc84260eea987f848e2a42b41c873efee4b5b602224c0d1',39684,'atlas-private-data/sha256/93/93f6308ea99aac076bc84260eea987f848e2a42b41c873efee4b5b602224c0d1.bin'),
  ('limitations/opinion-text/il-best-1997.txt','b6e0caabaf80661478a0ca23829407c49101f554f32e73c9872cf455c39c3212',237078,'atlas-private-data/sha256/b6/b6e0caabaf80661478a0ca23829407c49101f554f32e73c9872cf455c39c3212.bin'),
  ('limitations/opinion-text/in-myers-2016.txt','e616b09c9d57093c70568bccfcf745e56ab530289ddd3689ea94c1e3365d6b9a',45137,'atlas-private-data/sha256/e6/e616b09c9d57093c70568bccfcf745e56ab530289ddd3689ea94c1e3365d6b9a.bin'),
  ('limitations/opinion-text/nd-dickie-2000.txt','84709b3fa3de7f3c99b7c2ce11433e45a25454d5feefc135e9d1d7be42b8646e',16830,'atlas-private-data/sha256/84/84709b3fa3de7f3c99b7c2ce11433e45a25454d5feefc135e9d1d7be42b8646e.bin'),
  ('limitations/opinion-text/pa-neiman-2013.txt','59f3d672d7c222fbf0a154851cef37ee2a74b78e5f8efd895e090f614fa67e64',42532,'atlas-private-data/sha256/59/59f3d672d7c222fbf0a154851cef37ee2a74b78e5f8efd895e090f614fa67e64.bin'),
  ('limitations/opinion-text/us-atlantic-marine-2013.txt','f89dbd7d4fe39b1b54b05ea6526e4b6abf5fe71e715df497263edc151d646d45',44911,'atlas-private-data/sha256/f8/f89dbd7d4fe39b1b54b05ea6526e4b6abf5fe71e715df497263edc151d646d45.bin'),
  ('limitations/opinion-text/us-dobbs-2016.txt','d541f823f7080ab1a7097e90d3edf9b96247b77eb90ea2f80c4cafc0eb1d629e',14175,'atlas-private-data/sha256/d5/d541f823f7080ab1a7097e90d3edf9b96247b77eb90ea2f80c4cafc0eb1d629e.bin'),
  ('limitations/opinion-text/us-ferens-1990.txt','0f77d203c09ca5e606d89dd919d52e007fbb5fc1c3bc4310e13bfc533ce67391',65328,'atlas-private-data/sha256/0f/0f77d203c09ca5e606d89dd919d52e007fbb5fc1c3bc4310e13bfc533ce67391.bin'),
  ('limitations/opinion-text/us-lexecon-1998.txt','4e787f00479475a5c0fa545cbabfb7353818cfac88e19c28e1187396f05499ad',47370,'atlas-private-data/sha256/4e/4e787f00479475a5c0fa545cbabfb7353818cfac88e19c28e1187396f05499ad.bin'),
  ('limitations/opinion-text/us-looper-lambert-2021.txt','59ca280aff264f1e09a308cdfaab9118bd6e6345c18356c58eef87ff8258c4fd',41379,'atlas-private-data/sha256/59/59ca280aff264f1e09a308cdfaab9118bd6e6345c18356c58eef87ff8258c4fd.bin'),
  ('limitations/opinion-text/us-menowitz-1993.txt','1994268e1772d71782125c098d69e351c63625114e13411ff807301623eae8ad',18594,'atlas-private-data/sha256/19/1994268e1772d71782125c098d69e351c63625114e13411ff807301623eae8ad.bin'),
  ('limitations/opinion-text/us-vandusen-1964.txt','306f6f8e1fe556a083fcc7d06fa8272211681d30694ba0eede5454afd900b897',91365,'atlas-private-data/sha256/30/306f6f8e1fe556a083fcc7d06fa8272211681d30694ba0eede5454afd900b897.bin'),
  ('limitations/publisher-overrides.json','72f7fe888dd06bf05dec99d1d5a25636bdd84f23ff7ef7e0fceb8a8beb1d8ea9',7733,'atlas-private-data/sha256/72/72f7fe888dd06bf05dec99d1d5a25636bdd84f23ff7ef7e0fceb8a8beb1d8ea9.bin'),
  ('limitations/rejected-captures.json','ab9a1d53a546941dbcf697490b6a332c0f34753566acbba44f1fb519a930e239',10128,'atlas-private-data/sha256/ab/ab9a1d53a546941dbcf697490b6a332c0f34753566acbba44f1fb519a930e239.bin'),
  ('limitations/rules.json','e015d2e4140147e1e8aac9e4110dca806d7cd02ebb37ef3bdd366b7fe5744238',221270,'atlas-private-data/sha256/e0/e015d2e4140147e1e8aac9e4110dca806d7cd02ebb37ef3bdd366b7fe5744238.bin'),
  ('limitations/sources.json','c8a4bdb9715f84085caed3dc1d15827b37a6ed7565728a2dcc150b97a0642310',92880,'atlas-private-data/sha256/c8/c8a4bdb9715f84085caed3dc1d15827b37a6ed7565728a2dcc150b97a0642310.bin'),
  ('limitations/text/ak-9-10-070.txt','2be64c3240efeaa39cbc46f84ff6ce2f8376a3bcc627f992db51b999399a03b0',1140,'atlas-private-data/sha256/2b/2be64c3240efeaa39cbc46f84ff6ce2f8376a3bcc627f992db51b999399a03b0.bin'),
  ('limitations/text/al-6-2-38.txt','7aff58dc7b1548e243141d005926acb3d7cb2fb49d4a2a4f611009a43c7d382c',4036,'atlas-private-data/sha256/7a/7aff58dc7b1548e243141d005926acb3d7cb2fb49d4a2a4f611009a43c7d382c.bin'),
  ('limitations/text/az-12-542.txt','e26c6de40ef1832a96a247b45c2db46f650bce659bdc7d34146b591680739871',1011,'atlas-private-data/sha256/e2/e26c6de40ef1832a96a247b45c2db46f650bce659bdc7d34146b591680739871.bin'),
  ('limitations/text/az-12-551.txt','767140f6d0ac7ebfeeae7e9548daf34a9a9ce75a484a0fafac8e6fa9f2d77bfe',509,'atlas-private-data/sha256/76/767140f6d0ac7ebfeeae7e9548daf34a9a9ce75a484a0fafac8e6fa9f2d77bfe.bin'),
  ('limitations/text/ca-12a.txt','a2b5749fedff5fd5865fd8c4368a0d22f996eecccb5db0e5ae6120e8bedab0e8',1459,'atlas-private-data/sha256/a2/a2b5749fedff5fd5865fd8c4368a0d22f996eecccb5db0e5ae6120e8bedab0e8.bin'),
  ('limitations/text/ca-335-1.txt','640af55989c3a1600733b2dca066d0a3cca953e114867600eee27d7c8e1fed17',1059,'atlas-private-data/sha256/64/640af55989c3a1600733b2dca066d0a3cca953e114867600eee27d7c8e1fed17.bin'),
  ('limitations/text/ca-352.txt','cdd7d0ac5694d7ebc8f483ec5c02643c60fea4a8d97b2015fd28333da272f568',1685,'atlas-private-data/sha256/cd/cdd7d0ac5694d7ebc8f483ec5c02643c60fea4a8d97b2015fd28333da272f568.bin'),
  ('limitations/text/co-t13-a80-2026.txt','958c71ae65637cb62f06d30a84a7af5c56b3b59de17bd0643edf79675ef644e1',300377,'atlas-private-data/sha256/95/958c71ae65637cb62f06d30a84a7af5c56b3b59de17bd0643edf79675ef644e1.bin'),
  ('limitations/text/ct-ch926.txt','d8026c392b2078b553d568af2dc50c3b70585ca3303af803483d06cb6cdcfa09',160414,'atlas-private-data/sha256/d8/d8026c392b2078b553d568af2dc50c3b70585ca3303af803483d06cb6cdcfa09.bin'),
  ('limitations/text/dc-12-301.txt','bdb382d20c248a804080f1ec3d5c6d5e790421d792cfe844fafd3f293cb9f903',2283,'atlas-private-data/sha256/bd/bdb382d20c248a804080f1ec3d5c6d5e790421d792cfe844fafd3f293cb9f903.bin'),
  ('limitations/text/dc-12-311.txt','9cf5d7f6636736d64be0a801e086da00747380938ae308965f1e5c79885f9fe3',1459,'atlas-private-data/sha256/9c/9cf5d7f6636736d64be0a801e086da00747380938ae308965f1e5c79885f9fe3.bin'),
  ('limitations/text/de-10c81.txt','85b36594b313ea5ea32553c6f76a0e6c0e0ba73cc18cb23d590ee1b14e0febac',59856,'atlas-private-data/sha256/85/85b36594b313ea5ea32553c6f76a0e6c0e0ba73cc18cb23d590ee1b14e0febac.bin'),
  ('limitations/text/fl-95-031.txt','c7b80641cf0f670b88c4bf5c102438c0cf7d5eefbc6ba466e84b36d9754f8eec',10288,'atlas-private-data/sha256/c7/c7b80641cf0f670b88c4bf5c102438c0cf7d5eefbc6ba466e84b36d9754f8eec.bin'),
  ('limitations/text/fl-95-11.txt','2032e4a7e4ae1f400fef7ced57a0f22089701d0189d41dc220b3ab83de1e0835',16044,'atlas-private-data/sha256/20/2032e4a7e4ae1f400fef7ced57a0f22089701d0189d41dc220b3ab83de1e0835.bin'),
  ('limitations/text/hi-657-7.txt','689ff4fd1ef461ea0a4de692321fbb66ae084f1207fad0fa4de0801e5650ce34',17796,'atlas-private-data/sha256/68/689ff4fd1ef461ea0a4de692321fbb66ae084f1207fad0fa4de0801e5650ce34.bin'),
  ('limitations/text/ia-c614-2026.txt','23bb7ef763012b130341c07cc083b3cf3ecf7ca4e360d43f42790978ac8d72d8',56128,'atlas-private-data/sha256/23/23bb7ef763012b130341c07cc083b3cf3ecf7ca4e360d43f42790978ac8d72d8.bin'),
  ('limitations/text/id-5-219.txt','e577276aebdaf68236e405b66c353bdd29d9f3fe51de10d7ee0deb64e3032f77',11268,'atlas-private-data/sha256/e5/e577276aebdaf68236e405b66c353bdd29d9f3fe51de10d7ee0deb64e3032f77.bin'),
  ('limitations/text/il-13-202.txt','03a057d6af0883e45505d25d9a60c08dd23f0b3231c4895b48863cfb25dde662',1634,'atlas-private-data/sha256/03/03a057d6af0883e45505d25d9a60c08dd23f0b3231c4895b48863cfb25dde662.bin'),
  ('limitations/text/il-13-213.txt','a524ee66b444f97c77ef5e4bb3ae9e371d7d2777bd18ba20cbe84a87fbb21ea0',12763,'atlas-private-data/sha256/a5/a524ee66b444f97c77ef5e4bb3ae9e371d7d2777bd18ba20cbe84a87fbb21ea0.bin'),
  ('limitations/text/in-code-2026.txt','1aa5090c3c6b782d3411b7a08a82613ec90d7eb4e1d2fbd515cb926a7e95fd97',1903800,'atlas-private-data/sha256/1a/1aa5090c3c6b782d3411b7a08a82613ec90d7eb4e1d2fbd515cb926a7e95fd97.bin'),
  ('limitations/text/ks-60-3303.txt','3205cc3bf4286daaa921a884e4a241136e0444d9e42b286e723fca2954de21f3',16916,'atlas-private-data/sha256/32/3205cc3bf4286daaa921a884e4a241136e0444d9e42b286e723fca2954de21f3.bin'),
  ('limitations/text/ks-60-513.txt','f215f5f69d6b03c879645d00aadafe90695a2c392a50465a482062198f742966',104063,'atlas-private-data/sha256/f2/f215f5f69d6b03c879645d00aadafe90695a2c392a50465a482062198f742966.bin'),
  ('limitations/text/la-3493-1.txt','7cdf3dd66caaf6efff5359b15d7ffd1d8a4738a1a1288377a5a0786338ea812c',4894,'atlas-private-data/sha256/7c/7cdf3dd66caaf6efff5359b15d7ffd1d8a4738a1a1288377a5a0786338ea812c.bin'),
  ('limitations/text/ma-260-2a.txt','b5b5ec07e10d4978463481485ae7e175ea01efcac9512a892480a0721ad3cf9b',3218,'atlas-private-data/sha256/b5/b5b5ec07e10d4978463481485ae7e175ea01efcac9512a892480a0721ad3cf9b.bin'),
  ('limitations/text/md-cjp3-904.txt','0e3556bad067bbaf4a6e4cfd31652b18ea85616c50cff0d4d97709f053f193cb',13016,'atlas-private-data/sha256/0e/0e3556bad067bbaf4a6e4cfd31652b18ea85616c50cff0d4d97709f053f193cb.bin'),
  ('limitations/text/md-cjp5-101.txt','9713c698d7503eb33bb4135fead0536a2e9eb44a5c2d709b60a3b28ada685cb8',6529,'atlas-private-data/sha256/97/9713c698d7503eb33bb4135fead0536a2e9eb44a5c2d709b60a3b28ada685cb8.bin'),
  ('limitations/text/me-14-752.txt','c32666b67d9d94fcdd24c7ed5f1f82d096ed72f4b019fd22a83448c3907cd780',2716,'atlas-private-data/sha256/c3/c32666b67d9d94fcdd24c7ed5f1f82d096ed72f4b019fd22a83448c3907cd780.bin'),
  ('limitations/text/me-18c-2-807.txt','0e14ae3405b5b26509fe6e5e91c44a4e637c237ba146852592564ba1fd684611',7189,'atlas-private-data/sha256/0e/0e14ae3405b5b26509fe6e5e91c44a4e637c237ba146852592564ba1fd684611.bin'),
  ('limitations/text/mi-600-5805.txt','6c23d90ce39a8d6d21ebdd683a71eac7376b938c6fd9643f2d2efaf840c4bee2',12096,'atlas-private-data/sha256/6c/6c23d90ce39a8d6d21ebdd683a71eac7376b938c6fd9643f2d2efaf840c4bee2.bin'),
  ('limitations/text/mi-600-5827.txt','496521df73a60144aca04ac19f2ad2b6342cffa9a48325d3b135bb59650ee6d3',6339,'atlas-private-data/sha256/49/496521df73a60144aca04ac19f2ad2b6342cffa9a48325d3b135bb59650ee6d3.bin'),
  ('limitations/text/mn-541-05.txt','1bc3a14c687bbfa7714c6acd1e8858f77b73f171435c6aa672a3cae7329341ed',2590,'atlas-private-data/sha256/1b/1bc3a14c687bbfa7714c6acd1e8858f77b73f171435c6aa672a3cae7329341ed.bin'),
  ('limitations/text/mn-573-02.txt','39e6f70de9d6b9782997d0388bfde0404335a3741129aae2dc8a792105de4ece',5215,'atlas-private-data/sha256/39/39e6f70de9d6b9782997d0388bfde0404335a3741129aae2dc8a792105de4ece.bin'),
  ('limitations/text/mo-516-120.txt','ccb5065029afaa5d28068948f7c460ad0b4d950b00e4b0a9643a00988dd0ad21',9600,'atlas-private-data/sha256/cc/ccb5065029afaa5d28068948f7c460ad0b4d950b00e4b0a9643a00988dd0ad21.bin'),
  ('limitations/text/mt-27-2-204.txt','8b25b81e3b785cb4d31232afe06a73abb671bb410ea9ec3f3e221a5718341cfe',4641,'atlas-private-data/sha256/8b/8b25b81e3b785cb4d31232afe06a73abb671bb410ea9ec3f3e221a5718341cfe.bin'),
  ('limitations/text/nc-1-17.txt','940318615021d76df809792b5b70e3dc031a36cc032fc8d193e8de774d890ffe',3910,'atlas-private-data/sha256/94/940318615021d76df809792b5b70e3dc031a36cc032fc8d193e8de774d890ffe.bin'),
  ('limitations/text/nc-1-46-1.txt','3e7e0fe40ed2ea7ee7edf7951797499f745bc5bd97fe6ec13dad66a1c2044897',396,'atlas-private-data/sha256/3e/3e7e0fe40ed2ea7ee7edf7951797499f745bc5bd97fe6ec13dad66a1c2044897.bin'),
  ('limitations/text/nc-1-52.txt','5d7c7ed7e6e27af7154e47d817ce9b9fb23f8855d6de1d8dbb3bb4e35bbe79a1',5444,'atlas-private-data/sha256/5d/5d7c7ed7e6e27af7154e47d817ce9b9fb23f8855d6de1d8dbb3bb4e35bbe79a1.bin'),
  ('limitations/text/nc-1-53.txt','b032694f3fc89b85e33fc4750e5f1608537d6f1706da64525d261ac9cebad6dc',1891,'atlas-private-data/sha256/b0/b032694f3fc89b85e33fc4750e5f1608537d6f1706da64525d261ac9cebad6dc.bin'),
  ('limitations/text/nd-ch28-01-3.txt','3727dc2eddf275a1fe409a5997990ae02e354ef1776259a0441cfdad736d0d0b',11345,'atlas-private-data/sha256/37/3727dc2eddf275a1fe409a5997990ae02e354ef1776259a0441cfdad736d0d0b.bin'),
  ('limitations/text/nd-ch28-01.txt','25b54d300762d5acfe0760d527b88e115abd3e287e20eba7e70606d69a1ae506',34660,'atlas-private-data/sha256/25/25b54d300762d5acfe0760d527b88e115abd3e287e20eba7e70606d69a1ae506.bin'),
  ('limitations/text/nd-ch32-21.txt','36bb8096b52a04a5fefb662b3d9cfbcac0a5981360d9d3982ce6bd8550018fc4',2400,'atlas-private-data/sha256/36/36bb8096b52a04a5fefb662b3d9cfbcac0a5981360d9d3982ce6bd8550018fc4.bin'),
  ('limitations/text/ne-25-207.txt','1f6b5ab76e0b4302130a5a6aceebbc55aa2431663abe0ff47b9912bb100f253f',26716,'atlas-private-data/sha256/1f/1f6b5ab76e0b4302130a5a6aceebbc55aa2431663abe0ff47b9912bb100f253f.bin'),
  ('limitations/text/nh-508-4.txt','eb23854db03e1a322b3b8570ea5158a4b605c21659d9a5f6412f3ef6da3e2502',1057,'atlas-private-data/sha256/eb/eb23854db03e1a322b3b8570ea5158a4b605c21659d9a5f6412f3ef6da3e2502.bin'),
  ('limitations/text/nj-2019-c120.txt','cc6a976a39b7a979fba26dd07a06034b2ab8f809cd47336f81e2960804fd593e',21603,'atlas-private-data/sha256/cc/cc6a976a39b7a979fba26dd07a06034b2ab8f809cd47336f81e2960804fd593e.bin'),
  ('limitations/text/nm-ch37-fragment0.txt','0f09fd2edf25835ecc4a71911e9f1e545f4b25d41df7b9b0e246b2c021e214d5',24069,'atlas-private-data/sha256/0f/0f09fd2edf25835ecc4a71911e9f1e545f4b25d41df7b9b0e246b2c021e214d5.bin'),
  ('limitations/text/nm-ch41-fragment0.txt','88ed0a064c52e86f0d6d34ab3faa2d7169e38a67e9fe71a705d9a287d2891159',17276,'atlas-private-data/sha256/88/88ed0a064c52e86f0d6d34ab3faa2d7169e38a67e9fe71a705d9a287d2891159.bin'),
  ('limitations/text/nv-nrs11.txt','027d78facbabda6ffeb0355fc5e9e71c013e89513c5220d8212c78b5bf157ac5',67046,'atlas-private-data/sha256/02/027d78facbabda6ffeb0355fc5e9e71c013e89513c5220d8212c78b5bf157ac5.bin'),
  ('limitations/text/ny-cplr202.txt','8c3c220a9cfce6dcd332c7758a4d17ef2d52b2e80f429b0862ee95a1ac7418e6',4248,'atlas-private-data/sha256/8c/8c3c220a9cfce6dcd332c7758a4d17ef2d52b2e80f429b0862ee95a1ac7418e6.bin'),
  ('limitations/text/ny-cplr208.txt','23933803b1c10669a7f75fc8d99972756a7afafe914f7093cd8d5e9086f99cef',6694,'atlas-private-data/sha256/23/23933803b1c10669a7f75fc8d99972756a7afafe914f7093cd8d5e9086f99cef.bin'),
  ('limitations/text/ny-cplr214.txt','a3d87d043e4709e43b5735abbeb2e23970d36a33f55509a55ce1c752b99042fb',5798,'atlas-private-data/sha256/a3/a3d87d043e4709e43b5735abbeb2e23970d36a33f55509a55ce1c752b99042fb.bin'),
  ('limitations/text/ny-cplr214c.txt','4c09fa4695883718f86cdf2f2cc34d23350f23cd3ac96d5bb7cbc6916178c7c6',7424,'atlas-private-data/sha256/4c/4c09fa4695883718f86cdf2f2cc34d23350f23cd3ac96d5bb7cbc6916178c7c6.bin'),
  ('limitations/text/ny-ept-death.txt','72290bd239ad6eae941df87c6f128870fd8c54db593f029c380158ac8772128d',3115,'atlas-private-data/sha256/72/72290bd239ad6eae941df87c6f128870fd8c54db593f029c380158ac8772128d.bin'),
  ('limitations/text/oh-2305-10.txt','62128dbb0e84cd1322556b0555b26325fa5693a2400e7c6e83e978e840f0e626',11596,'atlas-private-data/sha256/62/62128dbb0e84cd1322556b0555b26325fa5693a2400e7c6e83e978e840f0e626.bin'),
  ('limitations/text/oh-2307-71.txt','122614f5cc322fed46e954aa5a9a0ba7e3a114f36ce5b9a8dc01e443a739f454',10803,'atlas-private-data/sha256/12/122614f5cc322fed46e954aa5a9a0ba7e3a114f36ce5b9a8dc01e443a739f454.bin'),
  ('limitations/text/ok-12-1053.txt','c4e778558f3b9462d8f1084e2187e16685f1a9293e8afcd6e1a3f6455fd99245',8124,'atlas-private-data/sha256/c4/c4e778558f3b9462d8f1084e2187e16685f1a9293e8afcd6e1a3f6455fd99245.bin'),
  ('limitations/text/ok-12-95.txt','0f052473740e932e803368e75096b5deb180412e0df38cd6d650b59887585346',6661,'atlas-private-data/sha256/0f/0f052473740e932e803368e75096b5deb180412e0df38cd6d650b59887585346.bin'),
  ('limitations/text/ok-12-96.txt','b8937ab08661770703769c6e3e5b1271ad6aa8738a44458debdd2595588f9d83',2553,'atlas-private-data/sha256/b8/b8937ab08661770703769c6e3e5b1271ad6aa8738a44458debdd2595588f9d83.bin'),
  ('limitations/text/or-c12.txt','8b9ca06dc92b1d5b4dcba0810bdaaddba4d6b9c1a71de3f617ef68b5a257b64e',49204,'atlas-private-data/sha256/8b/8b9ca06dc92b1d5b4dcba0810bdaaddba4d6b9c1a71de3f617ef68b5a257b64e.bin'),
  ('limitations/text/pa-t42c55.txt','8cdb83968735f944aabc3eca025b543f56a3791b5f5cf01d2c01043f20a066e7',74647,'atlas-private-data/sha256/8c/8cdb83968735f944aabc3eca025b543f56a3791b5f5cf01d2c01043f20a066e7.bin'),
  ('limitations/text/ri-9-1-14.txt','3e27e8889845728e5c4f5f831db3658c6c68b833672943ac9eba429989e8d53c',1615,'atlas-private-data/sha256/3e/3e27e8889845728e5c4f5f831db3658c6c68b833672943ac9eba429989e8d53c.bin'),
  ('limitations/text/sc-t15c3.txt','6acbbc87e96a21fba13e2bf8624b85f6c0c014ac0aaa6f50e3c3be9845766515',46979,'atlas-private-data/sha256/6a/6acbbc87e96a21fba13e2bf8624b85f6c0c014ac0aaa6f50e3c3be9845766515.bin'),
  ('limitations/text/sd-15-2-14.txt','f51d51401d95a7dea4a7b929408071c5c60a620673a3d675aa76e7a054124f78',3421,'atlas-private-data/sha256/f5/f51d51401d95a7dea4a7b929408071c5c60a620673a3d675aa76e7a054124f78.bin'),
  ('limitations/text/tx-cp16.txt','5d93754e54beb634189550e2c45cfde124c863451fcde78f22439621159a72e4',57380,'atlas-private-data/sha256/5d/5d93754e54beb634189550e2c45cfde124c863451fcde78f22439621159a72e4.bin'),
  ('limitations/text/us-28-1404-2024.txt','0ee88ee4226930855bee7d7e4c141fd3c53f3d60640d02f00dd336155df87eb4',5756,'atlas-private-data/sha256/0e/0ee88ee4226930855bee7d7e4c141fd3c53f3d60640d02f00dd336155df87eb4.bin'),
  ('limitations/text/us-28-1407-2024.txt','7edac2d54e92cc650be412bcd8a1f5800bb3cf12e0211a983e075d8b4dab8046',6855,'atlas-private-data/sha256/7e/7edac2d54e92cc650be412bcd8a1f5800bb3cf12e0211a983e075d8b4dab8046.bin'),
  ('limitations/text/us-28-1652-2024.txt','58ef1c39aaabd94d7822b306d0cbb35eac83e5a4b31d43241725d8680f580f3f',974,'atlas-private-data/sha256/58/58ef1c39aaabd94d7822b306d0cbb35eac83e5a4b31d43241725d8680f580f3f.bin'),
  ('limitations/text/us-28-2072-2024.txt','150146568b0a1ebe13387bc032a4d7f906a0febddd53f868e12774465df71176',3083,'atlas-private-data/sha256/15/150146568b0a1ebe13387bc032a4d7f906a0febddd53f868e12774465df71176.bin'),
  ('limitations/text/ut-78b-2-307.txt','d1d96e306fa17566259d4410939d88a1bb882414dad1d84190f0f7e86410530e',12297,'atlas-private-data/sha256/d1/d1d96e306fa17566259d4410939d88a1bb882414dad1d84190f0f7e86410530e.bin'),
  ('limitations/text/va-8-01-229.txt','441c5b66a3fb784efa6c1b8c6a29b219d8b51209b7ee4c66e18c64f1973dd538',16001,'atlas-private-data/sha256/44/441c5b66a3fb784efa6c1b8c6a29b219d8b51209b7ee4c66e18c64f1973dd538.bin'),
  ('limitations/text/va-8-01-230.txt','234a754b8fa5636c7c759d3ce72fa1d5b4a51ae8ff9d4e063faeeaca79dd6ef6',5837,'atlas-private-data/sha256/23/234a754b8fa5636c7c759d3ce72fa1d5b4a51ae8ff9d4e063faeeaca79dd6ef6.bin'),
  ('limitations/text/va-8-01-243.txt','e7062053ba73ef0be7b2759da3550ab585bafce96aab8866341e283b1c07240b',6700,'atlas-private-data/sha256/e7/e7062053ba73ef0be7b2759da3550ab585bafce96aab8866341e283b1c07240b.bin'),
  ('limitations/text/va-8-01-244.txt','7f6e1aa3e7a05b7c3e53230256c94496fdb24517792c12ef1e2af1e977a94b0d',3077,'atlas-private-data/sha256/7f/7f6e1aa3e7a05b7c3e53230256c94496fdb24517792c12ef1e2af1e977a94b0d.bin'),
  ('limitations/text/va-8-01-249.txt','3cdd2f30289b4ded716eb29fcd2224dbed6aded522521dd45d3e4f988710a8c7',7914,'atlas-private-data/sha256/3c/3cdd2f30289b4ded716eb29fcd2224dbed6aded522521dd45d3e4f988710a8c7.bin'),
  ('limitations/text/vt-12-512.txt','4d647fd63988d8789fcc79c3234c545bc1823775683dc808bc6eed18fed288dc',20717,'atlas-private-data/sha256/4d/4d647fd63988d8789fcc79c3234c545bc1823775683dc808bc6eed18fed288dc.bin'),
  ('limitations/text/vt-14-1492.txt','44ab336fa6e0aa88ae7d48be147da1e04699518e543af44500948ee3b8ef7e96',24917,'atlas-private-data/sha256/44/44ab336fa6e0aa88ae7d48be147da1e04699518e543af44500948ee3b8ef7e96.bin'),
  ('limitations/text/wa-4-16-080.txt','e59bf9a17144ee64aa2d8feab280aac2990d63e03dbe48f177c3dda56c923334',15528,'atlas-private-data/sha256/e5/e59bf9a17144ee64aa2d8feab280aac2990d63e03dbe48f177c3dda56c923334.bin'),
  ('limitations/text/wi-893-54.txt','9946c0a3f3282bfb31ad5b6e89f13951af9b89e39f5b4e07f4dead3d505d8b78',45733,'atlas-private-data/sha256/99/9946c0a3f3282bfb31ad5b6e89f13951af9b89e39f5b4e07f4dead3d505d8b78.bin'),
  ('limitations/text/wv-55-2-12.txt','36350cb8e617e8019943a285ee2fec12dbd041adf79d177198fcea69a54eea78',8243,'atlas-private-data/sha256/36/36350cb8e617e8019943a285ee2fec12dbd041adf79d177198fcea69a54eea78.bin'),
  ('limitations/text/wy-title1c3-2026.txt','dfd75fa9968e95deae81498fc19d281725ec57d0d2402494803a3819c6da858f',10175,'atlas-private-data/sha256/df/dfd75fa9968e95deae81498fc19d281725ec57d0d2402494803a3819c6da858f.bin'),
  ('matter-registry/attorneys.jsonl','9ecc75b18ff230a8345bafa58b1dbd1c8a58f836893f3df7368d3bdfd372bd4b',32767,'atlas-private-data/sha256/9e/9ecc75b18ff230a8345bafa58b1dbd1c8a58f836893f3df7368d3bdfd372bd4b.bin'),
  ('matter-registry/courts.jsonl','6afb2529b74968da4a7efc2b00b9498d43d802968434b7b75285532af049e545',4934,'atlas-private-data/sha256/6a/6afb2529b74968da4a7efc2b00b9498d43d802968434b7b75285532af049e545.bin'),
  ('matter-registry/docs/0c29c1c6-d0c2-5a46-a61b-a865eabfb783.json','27a2ece478daee1efc6864712f4bd5093ff1b19e75680a824077fb82e1fa1419',1265258,'atlas-private-data/sha256/27/27a2ece478daee1efc6864712f4bd5093ff1b19e75680a824077fb82e1fa1419.bin'),
  ('matter-registry/docs/1061c216-179c-50e3-a3b6-90ea60a215c4.json','9a52ef9e76c811a4c398c3cabb99b58ea8e1428ded04bbc96eacc6625dc83c6e',17021,'atlas-private-data/sha256/9a/9a52ef9e76c811a4c398c3cabb99b58ea8e1428ded04bbc96eacc6625dc83c6e.bin'),
  ('matter-registry/docs/1e717413-6b20-588b-903a-2acc192cb52a.json','0915b881cf270bcd0addd50925208802a9ecad1c3e69bc9835a4e72de4eeeb44',1183947,'atlas-private-data/sha256/09/0915b881cf270bcd0addd50925208802a9ecad1c3e69bc9835a4e72de4eeeb44.bin'),
  ('matter-registry/docs/219979e2-2842-543d-a5a8-deeba14f16f5.json','a44198486228f44bdd3286828bc4251cea9b279f7b252c2b273d2e9d404f6766',1713883,'atlas-private-data/sha256/a4/a44198486228f44bdd3286828bc4251cea9b279f7b252c2b273d2e9d404f6766.bin'),
  ('matter-registry/docs/2a592a74-f10d-52f1-8adc-5715fe4548e0.json','63d6ad46c77854e2587461ded3de7b0d64308c59644867fe53f7ff2e10a33ca4',187867,'atlas-private-data/sha256/63/63d6ad46c77854e2587461ded3de7b0d64308c59644867fe53f7ff2e10a33ca4.bin'),
  ('matter-registry/docs/385c8c33-0058-5994-8908-19ccbd6afdfd.json','d0bd4ce4790c4863e93f58e40dee84e1132d71ac6f21912fbc688bd811bac1c8',240440,'atlas-private-data/sha256/d0/d0bd4ce4790c4863e93f58e40dee84e1132d71ac6f21912fbc688bd811bac1c8.bin'),
  ('matter-registry/docs/3b3f1ea2-bf36-5a16-a8ec-7cf9d399adf4.json','1a336dd327993821ca33cbaa786ba3c5f32b5dbab7b27040306a79b3c831a8b8',95536,'atlas-private-data/sha256/1a/1a336dd327993821ca33cbaa786ba3c5f32b5dbab7b27040306a79b3c831a8b8.bin'),
  ('matter-registry/docs/54904b73-308e-567c-a568-3834fe34851c.json','5441c14c08f0b95661b33eb897c63ecc31c6716da90f7cacdee5a7cf642a9593',94089,'atlas-private-data/sha256/54/5441c14c08f0b95661b33eb897c63ecc31c6716da90f7cacdee5a7cf642a9593.bin'),
  ('matter-registry/docs/5845b900-bfd8-5ec1-882f-6880732e1af5.json','b252ade5533ffea6e69726e1200e01f416cbeade05e9f01880e9716224b1ce87',126486,'atlas-private-data/sha256/b2/b252ade5533ffea6e69726e1200e01f416cbeade05e9f01880e9716224b1ce87.bin'),
  ('matter-registry/docs/828788b8-d363-5a11-a3bc-2ef0950dc50c.json','e4ce271267ad2ca902b76b464d812e36973f170beeb4449f46981c10a43459e9',219459,'atlas-private-data/sha256/e4/e4ce271267ad2ca902b76b464d812e36973f170beeb4449f46981c10a43459e9.bin'),
  ('matter-registry/docs/8f841499-a607-5f6c-bbbe-866087a96414.json','dba95addcc480f82a4114763c80116e3c83628dcc89446ffc5b71164510907df',17383,'atlas-private-data/sha256/db/dba95addcc480f82a4114763c80116e3c83628dcc89446ffc5b71164510907df.bin'),
  ('matter-registry/docs/ac157a71-bf4a-5114-89dc-7cd499601fa9.json','7d84782c2b3b05f52fc6b63d244d6a6195ada29dd636d445117da380050ac2ac',2584636,'atlas-private-data/sha256/7d/7d84782c2b3b05f52fc6b63d244d6a6195ada29dd636d445117da380050ac2ac.bin'),
  ('matter-registry/docs/b30cc5df-89ee-5930-a40c-5c985f8ecd04.json','48d967831fa4825c221d8f505a7132f4fa7ac8cdc935da3fb343106b7caa9f54',1094879,'atlas-private-data/sha256/48/48d967831fa4825c221d8f505a7132f4fa7ac8cdc935da3fb343106b7caa9f54.bin'),
  ('matter-registry/docs/c6fec571-d55b-5607-be91-c3d4cb6fc745.json','f0044bb83525b41e52ad9eda4cc9d3b3f56f0ff8d2001675aab3536ab4a4bc8d',1151760,'atlas-private-data/sha256/f0/f0044bb83525b41e52ad9eda4cc9d3b3f56f0ff8d2001675aab3536ab4a4bc8d.bin'),
  ('matter-registry/docs/d3d651bb-37a0-5516-89cb-d6f0a97b7079.json','ce6bd73254f78c1ac90339a9c56576d692888f7ee654e2aacced40af47a014be',96874,'atlas-private-data/sha256/ce/ce6bd73254f78c1ac90339a9c56576d692888f7ee654e2aacced40af47a014be.bin'),
  ('matter-registry/docs/f1f0606b-be5a-5c3c-bac1-4fa931e1b151.json','4fcaa7d023b943acfc5ba917e279edcefe8186397458cd33c9ab2baf2d09a806',122630,'atlas-private-data/sha256/4f/4fcaa7d023b943acfc5ba917e279edcefe8186397458cd33c9ab2baf2d09a806.bin'),
  ('matter-registry/manifest.json','536fc42a2528029726954afbe9eca4ef24ef19b7cb9372ebf2134e784f284ac7',2055899,'atlas-private-data/sha256/53/536fc42a2528029726954afbe9eca4ef24ef19b7cb9372ebf2134e784f284ac7.bin'),
  ('matter-registry/matters.jsonl','22586d6540cea35d0cf600f0ded5c0e3a1a8d9f69ed8d748e2cf73e4b8b5fd9b',34014,'atlas-private-data/sha256/22/22586d6540cea35d0cf600f0ded5c0e3a1a8d9f69ed8d748e2cf73e4b8b5fd9b.bin'),
  ('matter-registry/outcomes.jsonl','e416e5d0b68abd0b7ca7595da7cc9c965f3ca73f0cd8738b7566ef2d12ae6a57',14283,'atlas-private-data/sha256/e4/e416e5d0b68abd0b7ca7595da7cc9c965f3ca73f0cd8738b7566ef2d12ae6a57.bin'),
  ('matter-registry/parties.jsonl','89c70fe413a5252f2050fadb3e8623db42e4617ebf333f5443973f3624a30f8d',104878,'atlas-private-data/sha256/89/89c70fe413a5252f2050fadb3e8623db42e4617ebf333f5443973f3624a30f8d.bin'),
  ('mdl-documents/court-azd.json','eee1bfbdf130ada416f076c0bf35665c6d9e738d5022f90da76f67a96ce8d932',4300411,'atlas-private-data/sha256/ee/eee1bfbdf130ada416f076c0bf35665c6d9e738d5022f90da76f67a96ce8d932.bin'),
  ('mdl-documents/court-cand.json','355eeb7dc3633135a8754194655415f061f1ba6db5374322754d0e5e41f7ec44',6064136,'atlas-private-data/sha256/35/355eeb7dc3633135a8754194655415f061f1ba6db5374322754d0e5e41f7ec44.bin'),
  ('mdl-documents/court-flnd.json','dccdf9ea97bfca0e8d2282a1d338bfb6f5e14c4edc922b52dde71a0f56c6d3b8',3283263,'atlas-private-data/sha256/dc/dccdf9ea97bfca0e8d2282a1d338bfb6f5e14c4edc922b52dde71a0f56c6d3b8.bin'),
  ('mdl-documents/court-ilnd.json','0fa890f6593f29c9927fcb27566c20114fe0a5fc2e7f922f49516358c6a8a644',5055024,'atlas-private-data/sha256/0f/0fa890f6593f29c9927fcb27566c20114fe0a5fc2e7f922f49516358c6a8a644.bin'),
  ('mdl-documents/court-ilsd.json','77a653c7709e9d5142502c6048d7a527ea13901a54e8d88b3698d635e22031e9',2000197,'atlas-private-data/sha256/77/77a653c7709e9d5142502c6048d7a527ea13901a54e8d88b3698d635e22031e9.bin'),
  ('mdl-documents/court-insd.json','167dded8ffda833a7937ea4936a63b77ec1fc6b6978450e3e056aa13f73645ae',2534327,'atlas-private-data/sha256/16/167dded8ffda833a7937ea4936a63b77ec1fc6b6978450e3e056aa13f73645ae.bin'),
  ('mdl-documents/court-laed.json','f7261cbc0e69c00dc3a8140a899ba7d2684acd1647495a3fb9b4f3430bce5156',4266527,'atlas-private-data/sha256/f7/f7261cbc0e69c00dc3a8140a899ba7d2684acd1647495a3fb9b4f3430bce5156.bin'),
  ('mdl-documents/court-njd.json','7ebcb5d8c68ee98a00c233bda9a5882e933204f53ad1f2cab6ad6eb2f516a75d',3426764,'atlas-private-data/sha256/7e/7ebcb5d8c68ee98a00c233bda9a5882e933204f53ad1f2cab6ad6eb2f516a75d.bin'),
  ('mdl-documents/court-ohnd.json','2be561a19b25d33fb5859c00cdf61cfab0d6b7d4fa367769eed369ca642c46ae',3660950,'atlas-private-data/sha256/2b/2be561a19b25d33fb5859c00cdf61cfab0d6b7d4fa367769eed369ca642c46ae.bin'),
  ('mdl-documents/court-ohsd.json','459055c9961a41ea057930d74247c629d484aec48b4f23a8aaf3f77df646c805',1071202,'atlas-private-data/sha256/45/459055c9961a41ea057930d74247c629d484aec48b4f23a8aaf3f77df646c805.bin'),
  ('mdl-documents/court-paed.json','319445aa7c37b1249fdfb1a7557363cc7d4b1743eb5f3da9c7f2051af3e5d506',1886012,'atlas-private-data/sha256/31/319445aa7c37b1249fdfb1a7557363cc7d4b1743eb5f3da9c7f2051af3e5d506.bin'),
  ('mdl-documents/court-scd.json','8e8095658668959e9e3e0b86cb60cb0372cdb8fc21e9ce5bc1489dd87b505c45',2901057,'atlas-private-data/sha256/8e/8e8095658668959e9e3e0b86cb60cb0372cdb8fc21e9ce5bc1489dd87b505c45.bin'),
  ('mdl-documents/index.json','cebb6be36f3b70b220ae6aa60bdfcf2fc9f140e6d38eb9b6516e0dd4aa088381',2995,'atlas-private-data/sha256/ce/cebb6be36f3b70b220ae6aa60bdfcf2fc9f140e6d38eb9b6516e0dd4aa088381.bin'),
  ('mdl-documents/master-dockets.json','220f8072dd80c7f1bacd3a59e675832a7ba5d6eaaa0b402045de174964816182',308,'atlas-private-data/sha256/22/220f8072dd80c7f1bacd3a59e675832a7ba5d6eaaa0b402045de174964816182.bin'),
  ('mdl-documents/mdl-2100.json','77a653c7709e9d5142502c6048d7a527ea13901a54e8d88b3698d635e22031e9',2000197,'atlas-private-data/sha256/77/77a653c7709e9d5142502c6048d7a527ea13901a54e8d88b3698d635e22031e9.bin'),
  ('mdl-documents/mdl-2570.json','167dded8ffda833a7937ea4936a63b77ec1fc6b6978450e3e056aa13f73645ae',2534327,'atlas-private-data/sha256/16/167dded8ffda833a7937ea4936a63b77ec1fc6b6978450e3e056aa13f73645ae.bin'),
  ('mdl-documents/mdl-2592.json','f7261cbc0e69c00dc3a8140a899ba7d2684acd1647495a3fb9b4f3430bce5156',4266527,'atlas-private-data/sha256/f7/f7261cbc0e69c00dc3a8140a899ba7d2684acd1647495a3fb9b4f3430bce5156.bin'),
  ('mdl-documents/mdl-2606.json','d0dfe0b74afe44487699d1a5e0ec99d9436aefcc5143f1a07c682adac5e59be0',1631291,'atlas-private-data/sha256/d0/d0dfe0b74afe44487699d1a5e0ec99d9436aefcc5143f1a07c682adac5e59be0.bin'),
  ('mdl-documents/mdl-2641.json','1945f5b95e409adbcd1afcba9d6b19c224484393a72088a32f1bd4eae4bb23ef',2264524,'atlas-private-data/sha256/19/1945f5b95e409adbcd1afcba9d6b19c224484393a72088a32f1bd4eae4bb23ef.bin'),
  ('mdl-documents/mdl-2789.json','cfa670d0bc3069b41ca5d1ccfe72732eed76c1360dd1286fc3ade2fb31af4062',1395076,'atlas-private-data/sha256/cf/cfa670d0bc3069b41ca5d1ccfe72732eed76c1360dd1286fc3ade2fb31af4062.bin'),
  ('mdl-documents/mdl-2804.json','2be561a19b25d33fb5859c00cdf61cfab0d6b7d4fa367769eed369ca642c46ae',3660950,'atlas-private-data/sha256/2b/2be561a19b25d33fb5859c00cdf61cfab0d6b7d4fa367769eed369ca642c46ae.bin'),
  ('mdl-documents/mdl-2846.json','459055c9961a41ea057930d74247c629d484aec48b4f23a8aaf3f77df646c805',1071202,'atlas-private-data/sha256/45/459055c9961a41ea057930d74247c629d484aec48b4f23a8aaf3f77df646c805.bin'),
  ('mdl-documents/mdl-2873.json','8e8095658668959e9e3e0b86cb60cb0372cdb8fc21e9ce5bc1489dd87b505c45',2901057,'atlas-private-data/sha256/8e/8e8095658668959e9e3e0b86cb60cb0372cdb8fc21e9ce5bc1489dd87b505c45.bin'),
  ('mdl-documents/mdl-2885.json','dccdf9ea97bfca0e8d2282a1d338bfb6f5e14c4edc922b52dde71a0f56c6d3b8',3283263,'atlas-private-data/sha256/dc/dccdf9ea97bfca0e8d2282a1d338bfb6f5e14c4edc922b52dde71a0f56c6d3b8.bin'),
  ('mdl-documents/mdl-2913.json','3d29dd3d2f34e2ae4b123f878d5a819ad0b835699751218d0172b7221d093728',2404011,'atlas-private-data/sha256/3d/3d29dd3d2f34e2ae4b123f878d5a819ad0b835699751218d0172b7221d093728.bin'),
  ('mdl-documents/mdl-2973.json','0f5845f01dd5c7ca1d18facbacc08a259b14c424a1f3fcf3643e67b274532caf',400399,'atlas-private-data/sha256/0f/0f5845f01dd5c7ca1d18facbacc08a259b14c424a1f3fcf3643e67b274532caf.bin'),
  ('mdl-documents/mdl-3047.json','b7193abbe919f068e8e497c91f32c4676c78b66a38d9eeb779456287fc6480d9',3660126,'atlas-private-data/sha256/b7/b7193abbe919f068e8e497c91f32c4676c78b66a38d9eeb779456287fc6480d9.bin'),
  ('mdl-documents/mdl-3081.json','ccb26016a8a7f6e306a896910c5b8c1df7832bfef67f4fec7b24b55e3fde024c',2035888,'atlas-private-data/sha256/cc/ccb26016a8a7f6e306a896910c5b8c1df7832bfef67f4fec7b24b55e3fde024c.bin'),
  ('mdl-documents/mdl-3094.json','319445aa7c37b1249fdfb1a7557363cc7d4b1743eb5f3da9c7f2051af3e5d506',1886012,'atlas-private-data/sha256/31/319445aa7c37b1249fdfb1a7557363cc7d4b1743eb5f3da9c7f2051af3e5d506.bin'),
  ('mdl-documents/mdl-unassigned.json','0fa890f6593f29c9927fcb27566c20114fe0a5fc2e7f922f49516358c6a8a644',5055024,'atlas-private-data/sha256/0f/0fa890f6593f29c9927fcb27566c20114fe0a5fc2e7f922f49516358c6a8a644.bin'),
  ('quality/bundled-audit.json','221da44084babb0600627d2196afaafe5719f9a8c7d5085eb52ab51a879ddbcc',13593,'atlas-private-data/sha256/22/221da44084babb0600627d2196afaafe5719f9a8c7d5085eb52ab51a879ddbcc.bin'),
  ('quality/category-schema-followup-2026-10-02.json','46f31d9bf8729e37780e4d6c9273ee68033f455d10372ad9d21df6a410bcf7c2',48483,'atlas-private-data/sha256/46/46f31d9bf8729e37780e4d6c9273ee68033f455d10372ad9d21df6a410bcf7c2.bin'),
  ('quality/corpus-enrichment-2026-10-02.json','31ca456f5375da85aac2181f0a6fea32417b7f5e920184dfdedc59da14cc1df0',19786,'atlas-private-data/sha256/31/31ca456f5375da85aac2181f0a6fea32417b7f5e920184dfdedc59da14cc1df0.bin'),
  ('quality/courtlistener-bulk-docket-graph-2026-10-02.json','745b584770c821e90f5947291fec4e69c01c1e60b2338ca334fc0e910be869f5',25889,'atlas-private-data/sha256/74/745b584770c821e90f5947291fec4e69c01c1e60b2338ca334fc0e910be869f5.bin'),
  ('quality/courtlistener-docket-projection-2026-10-02.json','415dae232586aa46573e37c9007516d6a9163c379e4e7e39d1bedb1425f145da',34852,'atlas-private-data/sha256/41/415dae232586aa46573e37c9007516d6a9163c379e4e7e39d1bedb1425f145da.bin'),
  ('quality/courtlistener-entry-analysis-2026-10-02-v1.json','96c7e14b45cf5f082e6c42f0b5ca5d06daa011c664ccc30fe4dd9c0e496dfd20',31116,'atlas-private-data/sha256/96/96c7e14b45cf5f082e6c42f0b5ca5d06daa011c664ccc30fe4dd9c0e496dfd20.bin'),
  ('quality/courtlistener-entry-analysis-2026-10-02-v3.json','08fddd6bc0a01d86272c56c7d144b58744cff73ad54d75b2c4091a1ce61e8400',33000,'atlas-private-data/sha256/08/08fddd6bc0a01d86272c56c7d144b58744cff73ad54d75b2c4091a1ce61e8400.bin'),
  ('quality/courtlistener-entry-analysis-2026-10-02.json','08fddd6bc0a01d86272c56c7d144b58744cff73ad54d75b2c4091a1ce61e8400',33000,'atlas-private-data/sha256/08/08fddd6bc0a01d86272c56c7d144b58744cff73ad54d75b2c4091a1ce61e8400.bin'),
  ('quality/courtlistener-live-private-import-2026-10-02.json','475d58490ea816e9df9a664835ff29c691d097a8ee24e2d7455aa43df6188615',11927,'atlas-private-data/sha256/47/475d58490ea816e9df9a664835ff29c691d097a8ee24e2d7455aa43df6188615.bin'),
  ('quality/courtlistener-reference-projection-2026-10-02.json','90979e84d5e2182eb1d0d7e037e70ac7f4a997cb3a4f8f14ab9cdae3a73a3afa',21550,'atlas-private-data/sha256/90/90979e84d5e2182eb1d0d7e037e70ac7f4a997cb3a4f8f14ab9cdae3a73a3afa.bin'),
  ('quality/database-audit.json','234413da2b9d371a14cbf6893d7cabf07e0135b78edd23c494101d6d17fc678d',222050,'atlas-private-data/sha256/23/234413da2b9d371a14cbf6893d7cabf07e0135b78edd23c494101d6d17fc678d.bin'),
  ('quality/ecfr-acquisition-2026-10-02.json','d6802b82cdc79b6de6dcddefcc2332ba87fd24ecc58983924b2aab944a0d2c4a',26291,'atlas-private-data/sha256/d6/d6802b82cdc79b6de6dcddefcc2332ba87fd24ecc58983924b2aab944a0d2c4a.bin'),
  ('quality/ecfr-independent-review-2026-10-02.json','477b02039c5e763570294ad41e0fbfadd19a3793f326c8f40208a972115b1f63',4528,'atlas-private-data/sha256/47/477b02039c5e763570294ad41e0fbfadd19a3793f326c8f40208a972115b1f63.bin'),
  ('quality/ecfr-publication-2026-10-02.json','145ce7fd1d90221b0ea90811094384e53d63d4be83806e67bfd9a892f4148ca1',18264,'atlas-private-data/sha256/14/145ce7fd1d90221b0ea90811094384e53d63d4be83806e67bfd9a892f4148ca1.bin'),
  ('quality/jpml-html-metadata-20261002.json','cc378de3e9e1d210d2807ccc485720b11b46aa8273c91af44cf1e8ed3b2fc2b7',217314,'atlas-private-data/sha256/cc/cc378de3e9e1d210d2807ccc485720b11b46aa8273c91af44cf1e8ed3b2fc2b7.bin'),
  ('quality/local-catalog-evidence-preparation-20261002.json','f04fb76343a249ecec1966021d0994a585bc08a737f483baad0a951cf2b92ee6',2680,'atlas-private-data/sha256/f0/f04fb76343a249ecec1966021d0994a585bc08a737f483baad0a951cf2b92ee6.bin'),
  ('quality/openfda-publication-2026-10-02.json','53bae90d8b7207bd4806c594a5acfcb12fb90c801879ab9438b7cbfc7bd9a83c',4986,'atlas-private-data/sha256/53/53bae90d8b7207bd4806c594a5acfcb12fb90c801879ab9438b7cbfc7bd9a83c.bin'),
  ('quality/openfda-source-review-2026-10-02.json','8765946e37fb6219da0ad04e25f92f47b44229ed011eb78b34bc63dc45a6ebc2',8500,'atlas-private-data/sha256/87/8765946e37fb6219da0ad04e25f92f47b44229ed011eb78b34bc63dc45a6ebc2.bin'),
  ('quality/reference/federal-register-gap/manifest.json','b92219b2561a523b34ab3dcd58bbe0e20426d7f6997c35622e2105283cd49a32',3872,'atlas-private-data/sha256/b9/b92219b2561a523b34ab3dcd58bbe0e20426d7f6997c35622e2105283cd49a32.bin'),
  ('quality/reference/federal-register-gap/page-001.json','1e98bbc5f6cdad07493472c17af7c8831fdb7f32c833c7c85a521426313b77f8',3304400,'atlas-private-data/sha256/1e/1e98bbc5f6cdad07493472c17af7c8831fdb7f32c833c7c85a521426313b77f8.bin'),
  ('quality/reference/federal-register-gap/page-002.json','165397bbe5d6a77d348f8da1cf1c6a2925eb8b36063705c8a5899233c1e53a45',3350180,'atlas-private-data/sha256/16/165397bbe5d6a77d348f8da1cf1c6a2925eb8b36063705c8a5899233c1e53a45.bin'),
  ('quality/reference/federal-register-gap/page-003.json','51c4f40f26e1d8b4372ad10b902e62651826c82bf2177d9e982eb142b8563f5e',3592680,'atlas-private-data/sha256/51/51c4f40f26e1d8b4372ad10b902e62651826c82bf2177d9e982eb142b8563f5e.bin'),
  ('quality/reference/federal-register-gap/page-004.json','8e5ffadbd1d18109d4d8900d7eb4a7ef70b92d396011ef74d08dab9603f61b6e',88303,'atlas-private-data/sha256/8e/8e5ffadbd1d18109d4d8900d7eb4a7ef70b92d396011ef74d08dab9603f61b6e.bin'),
  ('quality/reference/uscourts-table-c-2025.json','71573c278c0ebfe548a2e62e27849ab6f7cd5b597d9ec7b1e8d08848fe8ea1ff',35244,'atlas-private-data/sha256/71/71573c278c0ebfe548a2e62e27849ab6f7cd5b597d9ec7b1e8d08848fe8ea1ff.bin'),
  ('quality/reference/uscourts-table-c-2025.xlsx','289257cf3ec7fb33b74a28a8d0b267f26b321edb87b35f08df8468b627052ea7',21500,'atlas-private-data/sha256/28/289257cf3ec7fb33b74a28a8d0b267f26b321edb87b35f08df8468b627052ea7.bin'),
  ('quality/taxonomy-review-2026-10-02.json','b17d43bd9b4c7a49fc50199d822bcbff0f6c52a89bfccab04b23c2a0c3705535',4552,'atlas-private-data/sha256/b1/b17d43bd9b4c7a49fc50199d822bcbff0f6c52a89bfccab04b23c2a0c3705535.bin'),
  ('registry-v22/AK.json','d83c1f594a5f076e96c64206ca26189cc9460810d9b669f9c7f394c1e1c25015',165331,'atlas-private-data/sha256/d8/d83c1f594a5f076e96c64206ca26189cc9460810d9b669f9c7f394c1e1c25015.bin'),
  ('registry-v22/AL.json','2ddc3ef843f70d3b77dd80cb48642c316d9378571772afa0758c05ba6e04dbaa',154569,'atlas-private-data/sha256/2d/2ddc3ef843f70d3b77dd80cb48642c316d9378571772afa0758c05ba6e04dbaa.bin'),
  ('registry-v22/AR.json','17413c2f31f04c11309ae6fda0703281679643585081e1bbfb209ea30e1befa6',150412,'atlas-private-data/sha256/17/17413c2f31f04c11309ae6fda0703281679643585081e1bbfb209ea30e1befa6.bin'),
  ('registry-v22/AS.json','0a85a6e5d5270cc515b6327578bebc9f5e51c1597b5718800b1c194b9baa7b3a',1505,'atlas-private-data/sha256/0a/0a85a6e5d5270cc515b6327578bebc9f5e51c1597b5718800b1c194b9baa7b3a.bin'),
  ('registry-v22/AZ.json','563e0dffc6caeb41743156b328b2a5995ab817a15dfbe56264702828a61b3c8b',180367,'atlas-private-data/sha256/56/563e0dffc6caeb41743156b328b2a5995ab817a15dfbe56264702828a61b3c8b.bin'),
  ('registry-v22/CA.json','5b1b7faccb515fdc0a39adb9e5424c14fe4dc4a4fe5a4577f5e7a55489d98e8b',218095,'atlas-private-data/sha256/5b/5b1b7faccb515fdc0a39adb9e5424c14fe4dc4a4fe5a4577f5e7a55489d98e8b.bin'),
  ('registry-v22/CO.json','954ed7e74c4c8db49b486ead415215e4eac078fb8806516100b40eb64b8dcfc6',154284,'atlas-private-data/sha256/95/954ed7e74c4c8db49b486ead415215e4eac078fb8806516100b40eb64b8dcfc6.bin'),
  ('registry-v22/CT.json','9a231df49d4bacf921ea5eadcb1fb036b69a93f2832e72097ec0e42f2115fcb0',161214,'atlas-private-data/sha256/9a/9a231df49d4bacf921ea5eadcb1fb036b69a93f2832e72097ec0e42f2115fcb0.bin'),
  ('registry-v22/DC.json','e0179c2148a35e5a17b864692b1850b4656e72d632ace6d431994c3a4b179ae8',123499,'atlas-private-data/sha256/e0/e0179c2148a35e5a17b864692b1850b4656e72d632ace6d431994c3a4b179ae8.bin'),
  ('registry-v22/DE.json','9d0e84e86d5be00f165831ad1e121775930406553bc641bf45ad41e66f3fc719',149317,'atlas-private-data/sha256/9d/9d0e84e86d5be00f165831ad1e121775930406553bc641bf45ad41e66f3fc719.bin'),
  ('registry-v22/FL.json','49961a9f1d1d9118e01c3019891ee1ac0999f85f614fc683659ec4302f272f12',192308,'atlas-private-data/sha256/49/49961a9f1d1d9118e01c3019891ee1ac0999f85f614fc683659ec4302f272f12.bin'),
  ('registry-v22/GA.json','1f5531dcecf5577c855de53f365d0b81cf454fe14752d27551c47a77d9a3177d',148842,'atlas-private-data/sha256/1f/1f5531dcecf5577c855de53f365d0b81cf454fe14752d27551c47a77d9a3177d.bin'),
  ('registry-v22/GU.json','f2056224b6a4a2d4ec15f7f8911ff19c987581a8e10a5b53534b6be931bf7a1c',18627,'atlas-private-data/sha256/f2/f2056224b6a4a2d4ec15f7f8911ff19c987581a8e10a5b53534b6be931bf7a1c.bin'),
  ('registry-v22/HI.json','9eac7626b60c7d77bbf67ccf4213cca7f3c209d886e90c75a59b1ce4e77c098c',130115,'atlas-private-data/sha256/9e/9eac7626b60c7d77bbf67ccf4213cca7f3c209d886e90c75a59b1ce4e77c098c.bin'),
  ('registry-v22/IA.json','329d235a042362b615c6ff816caebc5146fe42e61715a158ad7a92aa604c5eb7',129351,'atlas-private-data/sha256/32/329d235a042362b615c6ff816caebc5146fe42e61715a158ad7a92aa604c5eb7.bin'),
  ('registry-v22/ID.json','1b812720852812d3a6fa2f64b3abbf1e3fce848da714104f82d8f39a00e213c9',129333,'atlas-private-data/sha256/1b/1b812720852812d3a6fa2f64b3abbf1e3fce848da714104f82d8f39a00e213c9.bin'),
  ('registry-v22/IL.json','10e6960376bda8d3dff179ca53cf0ebbe9361d36f98cda37dca7c57581a9a6a1',168374,'atlas-private-data/sha256/10/10e6960376bda8d3dff179ca53cf0ebbe9361d36f98cda37dca7c57581a9a6a1.bin'),
  ('registry-v22/IN.json','650cd4fbfe37fc2f7e6b368a867e6739b6309e3da532863a563907bd35d6e7f7',137936,'atlas-private-data/sha256/65/650cd4fbfe37fc2f7e6b368a867e6739b6309e3da532863a563907bd35d6e7f7.bin'),
  ('registry-v22/KS.json','a9474c6d614b703a8dee19b9cc58c85ae7558c790d3b38f2cf95848a1f6f8fb3',123119,'atlas-private-data/sha256/a9/a9474c6d614b703a8dee19b9cc58c85ae7558c790d3b38f2cf95848a1f6f8fb3.bin'),
  ('registry-v22/KY.json','ec718588096baa8f0cffe8160c7ad4b359a591159945512a25f7ab72739210e6',137522,'atlas-private-data/sha256/ec/ec718588096baa8f0cffe8160c7ad4b359a591159945512a25f7ab72739210e6.bin'),
  ('registry-v22/LA.json','b1ba586d2364ecbd180a307f0e3a447ac835869facda82081792555078c01584',135514,'atlas-private-data/sha256/b1/b1ba586d2364ecbd180a307f0e3a447ac835869facda82081792555078c01584.bin'),
  ('registry-v22/MA.json','90b147deedddd7906ba0f561044ce3f1b9920d0444e1e78ea71a8f87ac133009',174044,'atlas-private-data/sha256/90/90b147deedddd7906ba0f561044ce3f1b9920d0444e1e78ea71a8f87ac133009.bin'),
  ('registry-v22/MD.json','257b7c400f7135d0a43f1161a1cbc4b31d6d9aa6f3cf4b3a6540726ae2453c0d',165792,'atlas-private-data/sha256/25/257b7c400f7135d0a43f1161a1cbc4b31d6d9aa6f3cf4b3a6540726ae2453c0d.bin'),
  ('registry-v22/ME.json','d781f15803539b5d227b9965d6cf43dd80f533c2f80073159479a0f74044c23d',149169,'atlas-private-data/sha256/d7/d781f15803539b5d227b9965d6cf43dd80f533c2f80073159479a0f74044c23d.bin'),
  ('registry-v22/MI.json','731aa26cdf5aa0aea502b487584c21030fee23b3605519a5ec89da88eaab0ec6',138136,'atlas-private-data/sha256/73/731aa26cdf5aa0aea502b487584c21030fee23b3605519a5ec89da88eaab0ec6.bin'),
  ('registry-v22/MN.json','8556c20bac460d2f54e8f45427244555057ed1d0630be0b7c3a3af49c0d45072',152568,'atlas-private-data/sha256/85/8556c20bac460d2f54e8f45427244555057ed1d0630be0b7c3a3af49c0d45072.bin'),
  ('registry-v22/MO.json','4aa3776293f2e585af50fbea3acdddf8db5e32d9d12847b9e1de29d68e0a7fd6',132622,'atlas-private-data/sha256/4a/4aa3776293f2e585af50fbea3acdddf8db5e32d9d12847b9e1de29d68e0a7fd6.bin'),
  ('registry-v22/MP.json','0f8226492157309a49117df6be88f52e58fc618d7c405d069912f8c3d65f1b83',16464,'atlas-private-data/sha256/0f/0f8226492157309a49117df6be88f52e58fc618d7c405d069912f8c3d65f1b83.bin'),
  ('registry-v22/MS.json','7134bf9c670178f90fff25c5604ef66e6cc161b366484f660ccc442a35ae464e',117845,'atlas-private-data/sha256/71/7134bf9c670178f90fff25c5604ef66e6cc161b366484f660ccc442a35ae464e.bin'),
  ('registry-v22/MT.json','c5137365c0a91f917bf55fda356bd656199021ca8f0518389edc1cb133b98206',140470,'atlas-private-data/sha256/c5/c5137365c0a91f917bf55fda356bd656199021ca8f0518389edc1cb133b98206.bin'),
  ('registry-v22/MULTI.json','4ab061e1103032c3f5ede7d55681091a937b7d0f18ea4193e437f5bb0ffc0c00',47181,'atlas-private-data/sha256/4a/4ab061e1103032c3f5ede7d55681091a937b7d0f18ea4193e437f5bb0ffc0c00.bin'),
  ('registry-v22/NC.json','cf65677f9e138d77ae6d9bda877e67c9aca6ca2c33e5cb20c995dd8a838bea1a',157720,'atlas-private-data/sha256/cf/cf65677f9e138d77ae6d9bda877e67c9aca6ca2c33e5cb20c995dd8a838bea1a.bin'),
  ('registry-v22/ND.json','1e3b7aae44eaaf5fa4711a542794c21577361ce6bcb060295ab70e02c8d0ed6f',125518,'atlas-private-data/sha256/1e/1e3b7aae44eaaf5fa4711a542794c21577361ce6bcb060295ab70e02c8d0ed6f.bin'),
  ('registry-v22/NE.json','d8801ebfd3035a5a2af80b5cc113092439dabdf178d083820e0ec38cfc203475',127846,'atlas-private-data/sha256/d8/d8801ebfd3035a5a2af80b5cc113092439dabdf178d083820e0ec38cfc203475.bin'),
  ('registry-v22/NH.json','6ac4c669fda8b5c6e7374a4ff2d3b97de852e63df6a0ef3e09d1a2b7a0aa357d',125281,'atlas-private-data/sha256/6a/6ac4c669fda8b5c6e7374a4ff2d3b97de852e63df6a0ef3e09d1a2b7a0aa357d.bin'),
  ('registry-v22/NJ.json','a28ea6bc5ebc1d9827adda06956cabff7ad997bbd943280ba69f8bd8b3b904b4',167449,'atlas-private-data/sha256/a2/a28ea6bc5ebc1d9827adda06956cabff7ad997bbd943280ba69f8bd8b3b904b4.bin'),
  ('registry-v22/NM.json','af24a738c8135f0d766bd0c76e1378edc52111cd770daaef0d95269b6785e855',122231,'atlas-private-data/sha256/af/af24a738c8135f0d766bd0c76e1378edc52111cd770daaef0d95269b6785e855.bin'),
  ('registry-v22/NV.json','9daa965e3dc21d4ae95acddc3b8e221798e080bb3ce65f8fac5e690d70d370d5',119354,'atlas-private-data/sha256/9d/9daa965e3dc21d4ae95acddc3b8e221798e080bb3ce65f8fac5e690d70d370d5.bin'),
  ('registry-v22/NY.json','d7bdbc7b0101c5df155054f0c6de12e5194decc9715260e9f3ed38b94ff34c75',194643,'atlas-private-data/sha256/d7/d7bdbc7b0101c5df155054f0c6de12e5194decc9715260e9f3ed38b94ff34c75.bin'),
  ('registry-v22/OH.json','1b00e3318e09a4192c1c6a32215806e088c92c28654f83e072a1e28f4f552062',153662,'atlas-private-data/sha256/1b/1b00e3318e09a4192c1c6a32215806e088c92c28654f83e072a1e28f4f552062.bin'),
  ('registry-v22/OK.json','5465c9d509aefa316bb803fdc8a990ebb9e3d2e83893bcbf826e15cfc9cfa115',157100,'atlas-private-data/sha256/54/5465c9d509aefa316bb803fdc8a990ebb9e3d2e83893bcbf826e15cfc9cfa115.bin'),
  ('registry-v22/OR.json','ae62888f10d4379a21f8a132db76125954df27397bbc6f69dfb882043732fb75',162927,'atlas-private-data/sha256/ae/ae62888f10d4379a21f8a132db76125954df27397bbc6f69dfb882043732fb75.bin'),
  ('registry-v22/PA.json','77aa966e2a1636935d9ef7421808e5ba9f8e7d99ed416036e277bbba6ccdc44e',175198,'atlas-private-data/sha256/77/77aa966e2a1636935d9ef7421808e5ba9f8e7d99ed416036e277bbba6ccdc44e.bin'),
  ('registry-v22/PR.json','102cf718f4d66bbaa5a1cc3b3b1b21afccba7148e2bb7bb12ada9fb0bfa9d58e',42704,'atlas-private-data/sha256/10/102cf718f4d66bbaa5a1cc3b3b1b21afccba7148e2bb7bb12ada9fb0bfa9d58e.bin'),
  ('registry-v22/RI.json','3efecc80ffb92f616a8ea740f0791a4988c304df2ff089f9318c64350dfcbec3',132873,'atlas-private-data/sha256/3e/3efecc80ffb92f616a8ea740f0791a4988c304df2ff089f9318c64350dfcbec3.bin'),
  ('registry-v22/SC.json','5f82dc09be777417e3da37446e1fb5e1201005e00619295d4ce9d4ab3f13af66',164146,'atlas-private-data/sha256/5f/5f82dc09be777417e3da37446e1fb5e1201005e00619295d4ce9d4ab3f13af66.bin'),
  ('registry-v22/SD.json','17f199badf7e92cec92dda252acf742147fb6b36e21280936e3f00dfa35164fd',123380,'atlas-private-data/sha256/17/17f199badf7e92cec92dda252acf742147fb6b36e21280936e3f00dfa35164fd.bin'),
  ('registry-v22/TN.json','4446ccb09fd3a51a415f1f4b796c8dde4c522454ae5c1c3c163c309463aa4d2f',154187,'atlas-private-data/sha256/44/4446ccb09fd3a51a415f1f4b796c8dde4c522454ae5c1c3c163c309463aa4d2f.bin'),
  ('registry-v22/TX.json','dd9a3df70b05fe19a4b76d33b5a4df57b412a2cd5d45c09ffe0897680a3d26f0',205224,'atlas-private-data/sha256/dd/dd9a3df70b05fe19a4b76d33b5a4df57b412a2cd5d45c09ffe0897680a3d26f0.bin'),
  ('registry-v22/US.json','eb97578a2ba5dcfa9608adf441e0e97886987e34e00c6b59dae51775bfdaff87',2024429,'atlas-private-data/sha256/eb/eb97578a2ba5dcfa9608adf441e0e97886987e34e00c6b59dae51775bfdaff87.bin'),
  ('registry-v22/UT.json','4cfa57f1667f08fdea08110c76e0f4eea3f1938e00c171ae19990bee74775950',116164,'atlas-private-data/sha256/4c/4cfa57f1667f08fdea08110c76e0f4eea3f1938e00c171ae19990bee74775950.bin'),
  ('registry-v22/VA.json','321978471cdd5ebadee112b53ce91beeafccd20214d8962e7ec173984d94a684',163634,'atlas-private-data/sha256/32/321978471cdd5ebadee112b53ce91beeafccd20214d8962e7ec173984d94a684.bin'),
  ('registry-v22/VI.json','03ee675405680539c06061145e58645829d930b6430846eccf0692a26a0a58be',40679,'atlas-private-data/sha256/03/03ee675405680539c06061145e58645829d930b6430846eccf0692a26a0a58be.bin'),
  ('registry-v22/VT.json','f732fad3b21202c72999a98df824ca2cd74a1ac009fefd72aab15c358dc769b4',133410,'atlas-private-data/sha256/f7/f732fad3b21202c72999a98df824ca2cd74a1ac009fefd72aab15c358dc769b4.bin'),
  ('registry-v22/WA.json','9792e79a48eee656b910e026662248cf9f296935cedc4775d1e7144f749518cf',175744,'atlas-private-data/sha256/97/9792e79a48eee656b910e026662248cf9f296935cedc4775d1e7144f749518cf.bin'),
  ('registry-v22/WI.json','edfa805512997b30ec421f905308f581e61f2147eb5ac059c6a6f2cea10d9014',161423,'atlas-private-data/sha256/ed/edfa805512997b30ec421f905308f581e61f2147eb5ac059c6a6f2cea10d9014.bin'),
  ('registry-v22/WV.json','b0110157309af31d795e9f064192aa705f68debb1dbfecd335649d09304d8c25',158302,'atlas-private-data/sha256/b0/b0110157309af31d795e9f064192aa705f68debb1dbfecd335649d09304d8c25.bin'),
  ('registry-v22/WY.json','359a37c2a7acdc28e70039f4ae8d3682b9d7949df49eb85c78032e724f37f6d2',121930,'atlas-private-data/sha256/35/359a37c2a7acdc28e70039f4ae8d3682b9d7949df49eb85c78032e724f37f6d2.bin'),
  ('registry-v22/index.json','35b6d7ee806493c100c05b64579f2fc2de4732ab36d391982994c6e450b6c06d',3997,'atlas-private-data/sha256/35/35b6d7ee806493c100c05b64579f2fc2de4732ab36d391982994c6e450b6c06d.bin'),
  ('registry_v06_1.jsonl','6b375395edbfbf07ae39c731216627549870819bb2083e887b528793b9aba121',6367066,'atlas-private-data/sha256/6b/6b375395edbfbf07ae39c731216627549870819bb2083e887b528793b9aba121.bin'),
  ('research/court-crosswalk.json','a05fb946c1a15892029b3f6ba3997d28bb2b4580979eb1b9a86580b86f065515',156071,'atlas-private-data/sha256/a0/a05fb946c1a15892029b3f6ba3997d28bb2b4580979eb1b9a86580b86f065515.bin'),
  ('research/court-duration.json','cf6c4203ffb672fa366fa90201c34831de1189acba176060c6ee57ca84a6ca53',56443,'atlas-private-data/sha256/cf/cf6c4203ffb672fa366fa90201c34831de1189acba176060c6ee57ca84a6ca53.bin'),
  ('research/judicial-service.json','03031dc8d0c9d743205015fa8b15cd77fab3249189442642cac995e9e78e1432',2900805,'atlas-private-data/sha256/03/03031dc8d0c9d743205015fa8b15cd77fab3249189442642cac995e9e78e1432.bin'),
  ('research/mdl-briefs.json','cde8404c48de3b3e91464f6b2bf432527f5e95135a3f9c70808053bc75602fee',5618,'atlas-private-data/sha256/cd/cde8404c48de3b3e91464f6b2bf432527f5e95135a3f9c70808053bc75602fee.bin'),
  ('research/population.json','5df48db73cb03992aa07bdcdcd4e1f3f70cc80c3bd467932c186ce03400a8d82',7523,'atlas-private-data/sha256/5d/5df48db73cb03992aa07bdcdcd4e1f3f70cc80c3bd467932c186ce03400a8d82.bin'),
  ('research/raw/census-population-2025.csv','92188e29cb0a67dcf95afa7d6c47359409782f086478b70ea4128eb70e223ca9',53555,'atlas-private-data/sha256/92/92188e29cb0a67dcf95afa7d6c47359409782f086478b70ea4128eb70e223ca9.bin'),
  ('research/raw/doj-resources.json','64f8eb55160e2dbd09963ca39177057768379effd2d67bc555383a992fe386df',1036562,'atlas-private-data/sha256/64/64f8eb55160e2dbd09963ca39177057768379effd2d67bc555383a992fe386df.bin'),
  ('research/raw/fjc-demographics.csv','7c153cfc2e6e5bff1bdb9fbffb1cf12b50bd75c3374f00461ae57a1a588b2e20',492220,'atlas-private-data/sha256/7c/7c153cfc2e6e5bff1bdb9fbffb1cf12b50bd75c3374f00461ae57a1a588b2e20.bin'),
  ('research/raw/fjc-service.csv','6c3520441aad7dc87a6fab52a4df3326256f2c174c424fa094cb73c5b2ee6a14',1639011,'atlas-private-data/sha256/6c/6c3520441aad7dc87a6fab52a4df3326256f2c174c424fa094cb73c5b2ee6a14.bin'),
  ('research/raw/mdl-research.json','5803206da17d61457ff75df6f27cd491724b8b1bd8a3f76b2d10b2fbf9172a20',44070,'atlas-private-data/sha256/58/5803206da17d61457ff75df6f27cd491724b8b1bd8a3f76b2d10b2fbf9172a20.bin'),
  ('research/raw/uscourts-c5-2025.xlsx','0cb15e6e13c3503fc5aa63b488c7156e9444f92e956dce9b11f1076825ad4b83',19980,'atlas-private-data/sha256/0c/0cb15e6e13c3503fc5aa63b488c7156e9444f92e956dce9b11f1076825ad4b83.bin'),
  ('research/source-manifest.json','0a7e5a9fdec3520e727257ac03c7996d9727f849451187a88b7591a0d27ad317',3041,'atlas-private-data/sha256/0a/0a7e5a9fdec3520e727257ac03c7996d9727f849451187a88b7591a0d27ad317.bin'),
  ('research/state-resources.json','35587fadafa53da6b2be834440feeb6126237bb3e2e4ea1339f5f9bb5b893ce5',666584,'atlas-private-data/sha256/35/35587fadafa53da6b2be834440feeb6126237bb3e2e4ea1339f5f9bb5b893ce5.bin'),
  ('state-courts.json','2f591378d19eee9ff468b9ac1fe242eefbf7728cfae48c17ac72a28e09738528',285161,'atlas-private-data/sha256/2f/2f591378d19eee9ff468b9ac1fe242eefbf7728cfae48c17ac72a28e09738528.bin'),
  ('limitations/text/fl-2023-15.txt','f576892fa6835a3e39615ec27d868e5700e9b083faf08e038674d96cf17796b6',54429,'atlas-private-data/sha256/f5/f576892fa6835a3e39615ec27d868e5700e9b083faf08e038674d96cf17796b6.bin'),
  ('limitations/text/me-2023-c390.txt','b2681c5b2ce060757f12aebbba2fbc58166b5be175faccb473c98f613214fb55',11742,'atlas-private-data/sha256/b2/b2681c5b2ce060757f12aebbba2fbc58166b5be175faccb473c98f613214fb55.bin'),
  ('limitations/text/ky-413-140.txt','3f59d80649fd94e192844dd31d4f6086fa23c4bc3e24da8625266ec53b3558f7',5016,'atlas-private-data/sha256/3f/3f59d80649fd94e192844dd31d4f6086fa23c4bc3e24da8625266ec53b3558f7.bin'),
  ('limitations/text/dc-16-2702.txt','8edb4780d070b92571ffc3b61bd77e98c3c4fb42f97f612dc45e86662c1b75bd',1290,'atlas-private-data/sha256/8e/8edb4780d070b92571ffc3b61bd77e98c3c4fb42f97f612dc45e86662c1b75bd.bin'),
  ('limitations/text/mo-516-100.txt','53d05a2729ec3cab4b55fa6fd25477b534145918bf8f79e781a8387d57042e56',1663,'atlas-private-data/sha256/53/53d05a2729ec3cab4b55fa6fd25477b534145918bf8f79e781a8387d57042e56.bin'),
  ('limitations/text/mo-537-100.txt','c057800331652a32abd78d162544f82c8d1f1d6e54a5461a6a1976f4330a79f7',2183,'atlas-private-data/sha256/c0/c057800331652a32abd78d162544f82c8d1f1d6e54a5461a6a1976f4330a79f7.bin'),
  ('limitations/text/ne-30-810.txt','00f99fc2cb919e7068176d14c4a3be94a4b86b28475011a467a96b1736244e4f',19276,'atlas-private-data/sha256/00/00f99fc2cb919e7068176d14c4a3be94a4b86b28475011a467a96b1736244e4f.bin'),
  ('limitations/text/ut-title78b-ch2-2026.txt','e6045e5e62b3d3776fd1475a97ae5d662ea35dd9d8b85db6b5f20265c62cad00',51928,'atlas-private-data/sha256/e6/e6045e5e62b3d3776fd1475a97ae5d662ea35dd9d8b85db6b5f20265c62cad00.bin'),
  ('limitations/text/la-2024-423.txt','dac51a87ada134c5d226350585b63b80ab96165eee9d32542071dc3c9223b8d4',2195,'atlas-private-data/sha256/da/dac51a87ada134c5d226350585b63b80ab96165eee9d32542071dc3c9223b8d4.bin'),
  ('limitations/text/la-2315-2.txt','c36840b33c0511d9779ec3599a1e7dce2d7fda7feab85229eca6bed2c3b75532',2165,'atlas-private-data/sha256/c3/c36840b33c0511d9779ec3599a1e7dce2d7fda7feab85229eca6bed2c3b75532.bin'),
  ('limitations/text/la-2025-176.txt','082674a03187f51134f8ff7af6e49f3941005a016ca6161ee80a1c045d7c1d35',2245,'atlas-private-data/sha256/08/082674a03187f51134f8ff7af6e49f3941005a016ca6161ee80a1c045d7c1d35.bin'),
  ('limitations/text/wy-1-38-102.txt','889557a7a68a5918cadb66632348e79b9fe2b988866c42859309bff0b4302ad0',5721,'atlas-private-data/sha256/88/889557a7a68a5918cadb66632348e79b9fe2b988866c42859309bff0b4302ad0.bin'),
  ('limitations/opinion-text/us-cts-waldburger-2014.txt','0e7201da019627162163e281d18c466344c94066b7a4279876952c98402bcd2c',49987,'atlas-private-data/sha256/0e/0e7201da019627162163e281d18c466344c94066b7a4279876952c98402bcd2c.bin'),
  ('limitations/text/nc-1979-c654.txt','77e3ca27d76b146c8c02cb4b3724b65d1aa89bd616db5ea96ec546347f8d0ab2',7872,'atlas-private-data/sha256/77/77e3ca27d76b146c8c02cb4b3724b65d1aa89bd616db5ea96ec546347f8d0ab2.bin'),
  ('limitations/opinion-text/or-marshall-2023.txt','b6fb5232ab43d482144d5c38b45ccd3cc4a03924b70e89aacba7e63f5eb4f056',1245,'atlas-private-data/sha256/b6/b6fb5232ab43d482144d5c38b45ccd3cc4a03924b70e89aacba7e63f5eb4f056.bin'),
  ('limitations/text/or-1967-ch12.txt','c4334454bc29bb29757e4d4d27ba4e10b1c1f7a5d7c2b8974fbd8d78bb045420',21087,'atlas-private-data/sha256/c4/c4334454bc29bb29757e4d4d27ba4e10b1c1f7a5d7c2b8974fbd8d78bb045420.bin'),
  ('limitations/text/or-1967-disposition.txt','a6d045c68aa44c79f6748f4d1692ee1afec80fe1b3102dd90883077766ca2149',145407,'atlas-private-data/sha256/a6/a6d045c68aa44c79f6748f4d1692ee1afec80fe1b3102dd90883077766ca2149.bin'),
  ('limitations/text/or-1967-sb134.txt','362138a1a7a5b4284b3ac35bd92c6af625b17a48a3d89361ae26f923db2dd2cd',824,'atlas-private-data/sha256/36/362138a1a7a5b4284b3ac35bd92c6af625b17a48a3d89361ae26f923db2dd2cd.bin'),
  ('limitations/text/or-1967-session.txt','057c5192de595bd50ecc2c4d66d5b2aee22f1e3754c6bffaf69894624caaf3d3',5488,'atlas-private-data/sha256/05/057c5192de595bd50ecc2c4d66d5b2aee22f1e3754c6bffaf69894624caaf3d3.bin'),
  ('limitations/text/or-2026-volume1.txt','86e12931d691ea50fa18c081e68def45232f050159b5e096c82dbcd86d2eb6a7',6235,'atlas-private-data/sha256/86/86e12931d691ea50fa18c081e68def45232f050159b5e096c82dbcd86d2eb6a7.bin'),
  ('limitations/text/or-constitution.txt','aa6c46a519523b58b7020a7126cb6702e9fe69e4c7a9394e75c6251749beab64',371901,'atlas-private-data/sha256/aa/aa6c46a519523b58b7020a7126cb6702e9fe69e4c7a9394e75c6251749beab64.bin'),
  ('limitations/text/or-effective-date-guide.txt','4e0a5f61ad721c25d86723a4d4a84cb402ee2d7b87ffd51fe096c7d3e9fdd3a3',815792,'atlas-private-data/sha256/4e/4e0a5f61ad721c25d86723a4d4a84cb402ee2d7b87ffd51fe096c7d3e9fdd3a3.bin')
  /* PRIVATE_BUNDLE_MANIFEST_END */
), refs(ref_kind, bucket_id, object_key, expected_sha256, expected_bytes) AS (
  SELECT 'pdf_objects', p.bucket, p.storage_key, p.sha256, p.bytes::bigint
  FROM corpus_ingest.pdf_objects p
  UNION ALL
  SELECT 'corpus_artifacts', 'corpus-originals', a.object_key, a.sha256, a.bytes::bigint
  FROM public.corpus_artifacts a
  UNION ALL
  SELECT 'pdf_backfill_capture', 'corpus-originals', c.capture_storage_key, c.capture_sha256, c.capture_bytes::bigint
  FROM corpus_ingest.pdf_backfill_captures c
  UNION ALL
  SELECT 'pdf_backfill_metadata', 'corpus-originals', c.metadata_storage_key, c.metadata_sha256, c.metadata_bytes::bigint
  FROM corpus_ingest.pdf_backfill_captures c
  UNION ALL
  SELECT 'pdf_asset_observation', 'corpus-originals', o.observation->>'storage_key', o.observation->>'sha256',
         CASE WHEN o.observation->>'bytes' ~ '^[0-9]+$' THEN (o.observation->>'bytes')::bigint END
  FROM corpus_ingest.pdf_asset_observations o
  WHERE nullif(o.observation->>'storage_key','') IS NOT NULL
  UNION ALL
  SELECT 'local_pdf_expected_occurrence', 'corpus-originals', e.occurrence->>'intended_storage_key', e.occurrence->>'pdf_sha256',
         CASE WHEN e.occurrence->>'pdf_bytes' ~ '^[0-9]+$' THEN (e.occurrence->>'pdf_bytes')::bigint END
  FROM corpus_ingest.local_pdf_asset_expected_occurrences e
  WHERE nullif(e.occurrence->>'intended_storage_key','') IS NOT NULL
  UNION ALL
  SELECT 'local_pdf_cloud_verification', 'corpus-originals', o.cloud_verification->>'storage_key', o.cloud_verification->>'sha256', nullif(o.cloud_verification->>'bytes','')::bigint
  FROM corpus_ingest.local_pdf_asset_observations o
  WHERE nullif(o.cloud_verification->>'storage_key','') IS NOT NULL
  UNION ALL
  SELECT 'private_bundle_manifest', 'corpus-originals', m.object_key, m.sha256, m.bytes::bigint
  FROM private_bundle_manifest m
  UNION ALL
  SELECT 'legal_archive_manifest', a.bucket, a.manifest_key, a.manifest_sha256, NULL::bigint
  FROM legal_atlas.original_archives a
  UNION ALL
  SELECT 'legal_record_image_object_key', 'corpus-originals', r.payload->'attributes'->>'object_key', NULL::text, NULL::bigint
  FROM legal_atlas.records r
  WHERE r.type::text = 'image' AND nullif(r.payload->'attributes'->>'object_key','') IS NOT NULL
  UNION ALL
  SELECT 'legal_staging_candidate_object_key', 'corpus-originals', image.object_key, NULL::text, NULL::bigint
  FROM legal_atlas.staging s
  CROSS JOIN LATERAL jsonb_path_query(s.candidate_records, '$[*] ? (@.type == "image").attributes') AS attrs(value)
  CROSS JOIN LATERAL (SELECT attrs.value->>'object_key' AS object_key) AS image
  WHERE nullif(image.object_key,'') IS NOT NULL
  UNION ALL
  SELECT 'legal_staging_source_object_key', 'corpus-originals', image.object_key, NULL::text, NULL::bigint
  FROM legal_atlas.staging s
  CROSS JOIN LATERAL jsonb_path_query(s.source_record, '$ ? (@.type == "image").attributes') AS attrs(value)
  CROSS JOIN LATERAL (SELECT attrs.value->>'object_key' AS object_key) AS image
  WHERE nullif(image.object_key,'') IS NOT NULL
  UNION ALL
  SELECT 'legal_mdl_packet_image_object_key', 'corpus-originals', image.object_key, NULL::text, NULL::bigint
  FROM legal_atlas.mdl_packets p
  CROSS JOIN LATERAL jsonb_path_query(p.packet, '$.records[*] ? (@.type == "image").attributes') AS attrs(value)
  CROSS JOIN LATERAL (SELECT attrs.value->>'object_key' AS object_key) AS image
  WHERE nullif(image.object_key,'') IS NOT NULL
), ref_status AS (
  SELECT r.ref_kind, r.bucket_id, r.object_key, r.expected_sha256, r.expected_bytes,
         o.name IS NOT NULL AS object_exists,
         CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint END AS stored_bytes
  FROM refs r
  LEFT JOIN storage.objects o ON o.bucket_id=r.bucket_id AND o.name=r.object_key
)
SELECT 'bucket_totals' AS section, b.id AS bucket_id, count(o.id)::bigint AS object_rows,
       count(DISTINCT o.name)::bigint AS distinct_keys,
       sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint END)::numeric AS metadata_bytes,
       count(*) FILTER (WHERE o.id IS NOT NULL AND (o.metadata->>'size' IS NULL OR o.metadata->>'size' !~ '^[0-9]+$'))::bigint AS missing_or_invalid_size_rows,
       NULL::text AS ref_kind, NULL::bigint AS reference_count, NULL::bigint AS missing_objects,
       NULL::bigint AS size_mismatches, NULL::text AS object_key
FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id=b.id
GROUP BY b.id
UNION ALL
SELECT 'known_reference_totals', NULL, NULL, NULL, NULL, NULL, r.ref_kind,
       count(*)::bigint, count(*) FILTER (WHERE NOT r.object_exists)::bigint,
       count(*) FILTER (WHERE r.object_exists AND r.expected_bytes IS NOT NULL AND r.expected_bytes IS DISTINCT FROM r.stored_bytes)::bigint,
       NULL
FROM ref_status r GROUP BY r.ref_kind
UNION ALL
SELECT 'known_reference_conflict', r.bucket_id, NULL, NULL, NULL, NULL, r.ref_kind,
       NULL, NULL, NULL, r.object_key
FROM ref_status r
WHERE NOT r.object_exists OR (r.expected_bytes IS NOT NULL AND r.expected_bytes IS DISTINCT FROM r.stored_bytes)
UNION ALL
SELECT 'unreferenced_key_review_candidates', o.bucket_id, count(*)::bigint, NULL,
       sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint END)::numeric,
       NULL, 'not_found_in_known_ledgers', NULL, NULL, NULL, NULL
FROM storage.objects o
WHERE NOT EXISTS (SELECT 1 FROM ref_status r WHERE r.bucket_id=o.bucket_id AND r.object_key=o.name)
GROUP BY o.bucket_id
ORDER BY section, bucket_id NULLS FIRST, ref_kind NULLS FIRST;

-- 2. Hash-looking storage keys found under content-addressed paths. A repeated
-- hash across different keys is only a candidate: confirm actual body hashes,
-- all references, provider versions, and the canonical survivor before cleanup.
WITH path_hashes AS (
  SELECT o.bucket_id, o.name AS object_key,
         CASE
           WHEN o.name ~ '^seeger-weiss/pdf-sha256/[0-9a-f]{2}/[0-9a-f]{64}[.]pdf$' THEN substring(o.name FROM '([0-9a-f]{64})[.]pdf$')
           WHEN o.name ~ '^seeger-weiss/metadata-sha256/[0-9a-f]{2}/[0-9a-f]{64}[.]json$' THEN substring(o.name FROM '([0-9a-f]{64})[.]json$')
           WHEN o.name ~ '^seeger-weiss/focused-metadata-sha256/[0-9a-f]{2}/[0-9a-f]{64}[.]json$' THEN substring(o.name FROM '([0-9a-f]{64})[.]json$')
           WHEN o.name ~ '^seeger-weiss/full-matter-audit-sha256/[0-9a-f]{2}/[0-9a-f]{64}$' THEN substring(o.name FROM '([0-9a-f]{64})$')
           WHEN o.name ~ '^atlas-private-data/sha256/[0-9a-f]{2}/[0-9a-f]{64}[.]bin$' THEN substring(o.name FROM '/([0-9a-f]{64})[.]bin$')
           WHEN o.bucket_id='corpus-originals' AND o.name ~ '^[0-9a-f]{2}/[0-9a-f]{64}$' THEN substring(o.name FROM '^[0-9a-f]{2}/([0-9a-f]{64})$')
           WHEN o.name ~ '^legal-atlas/chunks/sha256/[0-9a-f]{64}$' THEN substring(o.name FROM 'sha256/([0-9a-f]{64})$')
           WHEN o.name ~ '^legal-atlas/originals/sha256/[0-9a-f]{64}/chunk-[0-9]{6}-[0-9a-f]{64}$' THEN substring(o.name FROM 'chunk-[0-9]{6}-([0-9a-f]{64})$')
         END AS path_sha256,
         CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint END AS bytes
  FROM storage.objects o
)
SELECT bucket_id, path_sha256, count(*)::bigint AS keys_for_path_hash,
       count(DISTINCT object_key)::bigint AS distinct_keys,
       min(bytes) AS min_declared_bytes, max(bytes) AS max_declared_bytes,
       array_agg(object_key ORDER BY object_key) AS object_keys
FROM path_hashes
WHERE path_sha256 IS NOT NULL
GROUP BY bucket_id, path_sha256
HAVING count(DISTINCT object_key)>1
ORDER BY count(DISTINCT object_key) DESC, bucket_id, path_sha256;

-- 3. PDF byte objects versus native association occurrences. A hash shared by
-- many source-native documents is expected deduplication, not a duplicate body.
SELECT source_system,
       count(*)::bigint AS association_occurrences,
       count(DISTINCT native_document_id)::bigint AS distinct_native_documents,
       count(DISTINCT sha256)::bigint AS distinct_pdf_hashes,
       count(DISTINCT (native_document_id, source_record_sha256))::bigint AS distinct_source_versions,
       count(*) FILTER (WHERE native_case_id IS NULL)::bigint AS associations_without_case_id
FROM corpus_ingest.pdf_document_assets
GROUP BY source_system
ORDER BY source_system;

SELECT count(*)::bigint AS pdf_object_rows,
       count(DISTINCT sha256)::bigint AS distinct_pdf_hashes,
       count(DISTINCT storage_key)::bigint AS distinct_storage_keys,
       sum(bytes)::numeric AS unique_registered_bytes,
       count(*) FILTER (WHERE bucket<>'corpus-originals')::bigint AS unexpected_bucket_rows
FROM corpus_ingest.pdf_objects;

SELECT sha256, count(*)::bigint AS source_association_occurrences,
       count(DISTINCT source_system)::bigint AS provider_count,
       count(DISTINCT native_document_id)::bigint AS native_document_count,
       min(o.bytes) AS bytes
FROM corpus_ingest.pdf_document_assets a
JOIN corpus_ingest.pdf_objects o USING (sha256)
GROUP BY sha256
HAVING count(*)>1
ORDER BY count(*) DESC, sha256
LIMIT 100;

-- 4. Relation size, estimates and dead tuples. pg_stat values are estimates;
-- compare after ordinary ANALYZE if their last_analyze timestamp is stale.
SELECT s.schemaname, s.relname,
       pg_size_pretty(pg_total_relation_size(s.relid)) AS total_size,
       pg_size_pretty(pg_table_size(s.relid)) AS table_and_toast_size,
       pg_size_pretty(pg_indexes_size(s.relid)) AS index_size,
       s.n_live_tup, s.n_dead_tup, s.last_analyze, s.last_autoanalyze,
       s.last_vacuum, s.last_autovacuum
FROM pg_stat_user_tables s
WHERE (s.schemaname,s.relname) IN (
  ('public','corpus_records'),('public','corpus_datasets'),('public','corpus_artifacts'),
  ('corpus_ingest','entities'),('corpus_ingest','entity_versions'),('corpus_ingest','observations'),
  ('corpus_ingest','relationships'),('corpus_ingest','pdf_objects'),('corpus_ingest','pdf_document_assets'),
  ('corpus_ingest','pdf_asset_observations'),('corpus_ingest','pdf_backfill_captures'),
  ('legal_atlas','original_archives'),('legal_atlas','records'),('legal_atlas','staging'),('legal_atlas','mdl_packets'),
  ('storage','objects')
)
ORDER BY pg_total_relation_size(s.relid) DESC;

-- Index usage on the same relations, including index bytes. idx_scan is
-- cumulative since statistics reset and is not a performance verdict alone.
SELECT schemaname, relname, indexrelname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
       idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE (schemaname,relname) IN (('public','corpus_records'),('corpus_ingest','entity_versions'),('corpus_ingest','observations'),('storage','objects'))
ORDER BY pg_relation_size(indexrelid) DESC;

-- 5. Biggest datasets, using the small catalog table's recorded import counts.
-- This avoids a full count/group scan over the large corpus_records relation.
SELECT id, label, ready, imported_records,
       metadata->>'expected_records' AS metadata_expected_records,
       metadata->'qualification' AS qualification
FROM public.corpus_datasets
ORDER BY imported_records DESC NULLS LAST
LIMIT 30;

-- Sample-based estimate of logical datum widths by dataset. This is not a
-- physical allocation estimate: it excludes heap/index/TOAST overhead and
-- TABLESAMPLE can miss small datasets. It is useful for finding which large
-- collections merit a targeted physical investigation without scanning all
-- corpus_records rows.
WITH sampled AS (
  SELECT r.dataset, count(*)::bigint AS sampled_rows,
         avg(coalesce(pg_column_size(r.text),0)::numeric
           + coalesce(pg_column_size(r.detail),0)::numeric
           + coalesce(pg_column_size(r.item),0)::numeric
           + coalesce(pg_column_size(r.filters),0)::numeric) AS avg_sampled_datum_bytes
  FROM public.corpus_records AS r TABLESAMPLE SYSTEM (0.05)
  GROUP BY r.dataset
)
SELECT d.id AS dataset, d.imported_records, s.sampled_rows,
       round(s.avg_sampled_datum_bytes)::bigint AS avg_sampled_datum_bytes,
       round(s.avg_sampled_datum_bytes * d.imported_records)::numeric AS estimated_logical_datum_bytes
FROM public.corpus_datasets d
LEFT JOIN sampled s ON s.dataset=d.id
ORDER BY estimated_logical_datum_bytes DESC NULLS LAST
LIMIT 30;

-- Held open_us_law inventory. The source audit found 2,938 rows whose source
-- host is govt.westlaw.com (Arizona and Maryland) and could not establish
-- acquisition lineage/terms. This query returns aggregate source counts only.
SELECT d.id, d.label, d.ready, d.imported_records,
       d.metadata->>'qualification' AS qualification,
       'The source audit dated 2026-10-02 identified 2,938 govt.westlaw.com URLs (Arizona and Maryland); this query intentionally avoids recounting/scanning the full 2.97M-row collection.' AS source_audit_note
FROM public.corpus_datasets d
WHERE d.id='open_us_law';

-- 6. Bounded physical sample of large JSON/text fields. This reads sizes only,
-- never displays record content. Correct Postgres placement is relation alias
-- before TABLESAMPLE: `AS r TABLESAMPLE SYSTEM (...)`.
SELECT r.dataset, count(*)::bigint AS sampled_rows,
       round(avg(pg_column_size(r.text))) AS avg_text_bytes,
       max(pg_column_size(r.text)) AS max_text_bytes,
       round(avg(pg_column_size(r.detail))) AS avg_detail_bytes,
       max(pg_column_size(r.detail)) AS max_detail_bytes,
       round(avg(pg_column_size(r.item))) AS avg_item_bytes,
       max(pg_column_size(r.item)) AS max_item_bytes,
       round(avg(pg_column_size(r.filters))) AS avg_filters_bytes
FROM public.corpus_records AS r TABLESAMPLE SYSTEM (0.05)
GROUP BY r.dataset
ORDER BY avg(pg_column_size(r.text)+pg_column_size(r.detail)+pg_column_size(r.item)) DESC NULLS LAST
LIMIT 30;

-- Focused sample for the held 2,968,623-row U.S. law collection. Sampling is
-- approximate. The source/rights hold is not a reason to drop or overwrite it.
SELECT count(*)::bigint AS sampled_rows,
       round(avg(pg_column_size(r.text))) AS avg_text_bytes,
       max(pg_column_size(r.text)) AS max_text_bytes,
       round(avg(pg_column_size(r.detail))) AS avg_detail_bytes,
       max(pg_column_size(r.detail)) AS max_detail_bytes,
       round(avg(pg_column_size(r.item))) AS avg_item_bytes,
       max(pg_column_size(r.item)) AS max_item_bytes
FROM public.corpus_records AS r TABLESAMPLE SYSTEM (0.10)
WHERE r.dataset='open_us_law';

-- 7. Logical/physical size of public.corpus_records components. Relation sizes
-- are exact metadata reads; row estimates are PostgreSQL statistics.
SELECT c.oid::regclass AS relation,
       c.reltuples::bigint AS estimated_live_rows,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap_main_fork,
       pg_size_pretty(pg_table_size(c.oid)-pg_relation_size(c.oid)) AS toast_and_forks,
       pg_size_pretty(pg_indexes_size(c.oid)) AS indexes,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total
FROM pg_class c
WHERE c.oid='public.corpus_records'::regclass;

-- No DELETE/TRUNCATE/UPDATE/ALTER/VACUUM FULL statement belongs in this audit.
-- Candidate means only "not located in the known reference ledgers above";
-- it does not account for chunk references inside opaque archive manifests,
-- stale external clients, historical recovery plans, or provider requirements.
