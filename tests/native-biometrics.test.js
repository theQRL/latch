import test from "node:test";
import assert from "node:assert/strict";
import { createNativeBiometrics } from "../shared/src/lib/native-biometrics.js";
import { wrapKey, unwrapKey } from "../shared/src/lib/device-unlock.js";
const credential = "00000000-0000-4000-8000-000000000001";
test("native biometric wrapping is recoverable only with the authenticated secret", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const native = createNativeBiometrics({ enroll: async () => ({credential, secret: Buffer.from(secret).toString('base64')}), unlock: async () => ({credential, secret: Buffer.from(secret).toString('base64')}) });
  const enrolled = await native.enroll();
  const appKey = crypto.getRandomValues(new Uint8Array(32));
  const wrapper = await wrapKey(appKey, enrolled.prf);
  const settings = {kind: enrolled.kind, credential, wrapper};
  enrolled.prf.fill(0);
  const recovered = await native.unlock(settings);
  assert.deepEqual(await unwrapKey(settings.wrapper,recovered), appKey);
  await assert.rejects(unwrapKey(wrapper,new Uint8Array(32)));
  assert.equal(JSON.stringify(settings).includes(Buffer.from(secret).toString('base64')),false);
  recovered.fill(0);
});
test("native adapter rejects wrong credentials, malformed secrets, and cleans failed enrollments", async () => {
  const removed=[];
  const native = createNativeBiometrics({enroll:async()=>({credential,secret:'AQ=='}),remove:async value=>removed.push(value),unlock:async()=>({credential:'wrong',secret:''})});
  await assert.rejects(native.enroll(), /Invalid biometric key/);
  assert.deepEqual(removed,[{credential}]);
  await assert.rejects(native.unlock({credential}), /Set up/);
  await assert.rejects(native.unlock({kind:'native-biometric-v1',credential}), /mismatch/);
});
