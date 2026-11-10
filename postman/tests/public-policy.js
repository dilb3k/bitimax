pm.test('public policy is available without authentication', () => pm.response.to.have.status(200));
pm.test('policy has bounded trading rules and no credentials', () => {
  const p = pm.response.json();
  pm.expect(p.commission).to.be.within(0, 100);
  pm.expect(p.paymentProvider).to.be.oneOf(['sms', 'hamyon']);
  pm.expect(p.paymentWindowMinutes).to.be.above(0);
  pm.expect(p.autoReleaseHours).to.be.above(0);
  pm.expect(p.unrevealedGraceHours).to.be.above(0);
  pm.expect(p.refundTiers).to.be.an('array').that.is.not.empty;
  pm.expect(Object.keys(p).sort()).to.eql(['autoReleaseHours', 'commission', 'paymentProvider', 'paymentWindowMinutes', 'refundTiers', 'unrevealedGraceHours']);
});
