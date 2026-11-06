import test from 'node:test';
import assert from 'node:assert/strict';
import { canPublishExpertDraft } from '../web/desktop/src/components/expertDraftModel.ts';
import type { ExpertDraft } from '../web/desktop/src/api/expertDrafts.ts';
test('publish confirmation is available only for the visible validated revision and an idle conversation',()=>{
  const draft={status:'valid',revision:2,validation:{valid:true,revision:2}} as ExpertDraft;
  assert.equal(canPublishExpertDraft(draft,false,false),true);
  assert.equal(canPublishExpertDraft({...draft,revision:3},false,false),false);
  assert.equal(canPublishExpertDraft(draft,true,false),false);
  assert.equal(canPublishExpertDraft(draft,false,true),false);
  assert.equal(canPublishExpertDraft({...draft,status:'published'},false,false),false);
});
