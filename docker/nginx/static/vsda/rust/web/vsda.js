define([], function () {
  'use strict';

  function NoopValidator() {}
  NoopValidator.prototype.createNewMessage = function (message) {
    return message;
  };
  NoopValidator.prototype.validate = function () {
    return 'ok';
  };
  NoopValidator.prototype.dispose = function () {};

  function NoopSigner() {}
  NoopSigner.prototype.sign = function (message) {
    return message;
  };

  // code-server only needs the module shape here. Returning pass-through
  // implementations keeps the browser bundle happy without pretending the
  // sandbox ships the native VSDA security feature set.
  return {
    validator: NoopValidator,
    signer: NoopSigner,
  };
});
