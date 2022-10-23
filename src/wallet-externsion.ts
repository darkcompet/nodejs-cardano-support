import * as S from '@emurgo/cardano-serialization-lib-nodejs';
import * as MS from '@emurgo/cardano-message-signing-nodejs';

/**
 * To handle with 3rd wallet extension as Nami, Yoroi, Typhon, Eterln,...
 */
export class DkCardanoWalletExtension {
	/**
	 * When we want to know the user is owner of the wallet, normally we
	 * require the user sign (enter password and confirm) a messagge (signature/payload) of us on the wallet.
	 * If succeed, we can determine the ownership between the user and the wallet.
	 *
	 * This method will determine if a wallet address signed a message (payload) which be sent from us.
	 *
	 * @param address Target wallet address to be verified. The address must be serialized in hex.
	 * @param payload Serialized sinagure (payload) (Normally, a description + nonce, be generated by backend)
	 * @param coseSign1Hex Sinature in hex string of signed payload (signed by user's wallet, obtained from external wallet)
	 * @param coseKeyHex Key in hex string of signed payload (signed by user's wallet, obtained from external wallet)
	 *
	 * @returns True if the payload was signed by wallet address
	 */
	static verifySignedMessage(address: string, payload: string, coseSign1Hex: string, coseKeyHex: string) {
		const coseSign1 = MS.COSESign1.from_bytes(Buffer.from(coseSign1Hex, 'hex'));
		const payloadCose = coseSign1.payload()!!;

		// Step 1. Validate signed message
		if (this.verifyPayload(payload, payloadCose)) {
			throw new Error('Payload mismatch');
		}

		// Step 2. Validate wallet address
		const protectedHeaders = coseSign1
			.headers()
			.protected()
			.deserialized_headers();

		const addressCose = S.Address.from_bytes(
			protectedHeaders.header(MS.Label.new_text('address'))!!.as_bytes()!!
		);

		// Commented out the below line in favor of CIP-30, only use if you are using the deprecated window.cardano.signedData(address, payload)
		//const publicKeyCose = S.PublicKey.from_bytes(protectedHeaders.key_id());
		const publicKeyBytes = MS.COSEKey
			.from_bytes(Buffer.from(coseKeyHex, 'hex'))
			.header(MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('2'))))!!
			.as_bytes()!!;

		const publicKeyCose = S.PublicKey.from_bytes(publicKeyBytes);

		if (!this.verifyAddress(address, addressCose, publicKeyCose)) {
			throw new Error('Address mismatch');
		}

		const signature = S.Ed25519Signature.from_bytes(coseSign1.signature());
		const signed_data = coseSign1.signed_data().to_bytes();

		return publicKeyCose.verify(signed_data, signature);
	}


	private static verifyPayload(payload: string, payloadCose: Uint8Array) {
		return Buffer.from(payloadCose).compare(Buffer.from(payload, 'hex'));
	}

	private static verifyAddress(address: string, addressCose: S.Address, publicKeyCose: S.PublicKey) {
		try {
			const checkAddress = S.Address.from_bytes(Buffer.from(address, 'hex'));

			if (addressCose.to_bech32() !== checkAddress.to_bech32()) {
				return false;
			}

			// Check if address is BaseAddress
			try {
				const baseAddress = S.BaseAddress.from_address(addressCose)!!;

				// Reconstruct address
				const paymentKeyHash = publicKeyCose.hash();
				const stakeKeyHash = baseAddress.stake_cred().to_keyhash()!!;
				const reconstructedAddress = S.BaseAddress.new(
					checkAddress.network_id(),
					S.StakeCredential.from_keyhash(paymentKeyHash),
					S.StakeCredential.from_keyhash(stakeKeyHash)
				);

				if (checkAddress.to_bech32() !== reconstructedAddress.to_address().to_bech32()) {
					return false;
				}

				return true;
			}
			catch (e: any) {
				console.log(`---> The address is not base address, error: ${e.message}`);
			}

			// Check if address is RewardAddress
			try {
				// Reconstruct address
				const stakeKeyHash = publicKeyCose.hash();

				const reconstructedAddress = S.RewardAddress.new(
					checkAddress.network_id(),
					S.StakeCredential.from_keyhash(stakeKeyHash)
				);

				if (checkAddress.to_bech32() !== reconstructedAddress.to_address().to_bech32()) {
					return false;
				}

				return true;
			}
			catch (e: any) {
				console.log(`---> The address is not reward address, error: ${e.message}`);
			}
		}
		catch (e: any) {
			console.log(`---> Could not verify address, error: ${e.message}`);
		}

		return false;
	}
}
