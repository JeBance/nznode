const { doRequest,
		getResponse } = require('nzfunc');
const { networkInterfaces } = require('os');

class nznode {
	CONFIG;
	DB;
	PGP;
	nodes;

	constructor(CONFIG, DB, PGP) {
		this.CONFIG = CONFIG;
		this.DB = DB;
		this.PGP = PGP;
		const nodes = JSON.parse(this.DB.read(null, 'nodes.json'));
		const type = Object.prototype.toString.call(nodes);
		if (type === '[object Object]' || type === '[object Array]') {
			this.nodes = nodes;
		} else {
			this.nodes = {};
		}
	}

	async add(node = { keyID: 'keyPGP', host: '127.0.0.1', port: 28262, ping: 10, publicKey: 'PGP public key' } ) {
		try {
			this.nodes[node.keyID] = {
				host: node.host,
				port: node.port,
				ping: node.ping
			};
			await this.DB.write('nodes', node.keyID, node.publicKey);
			await this.DB.write(null, 'nodes.json', JSON.stringify(this.nodes));
			console.log('\x1b[1m%s\x1b[0m', 'New node:', node.keyID, node.host + ':' + node.port, `(${node.ping} ms)`);
		} catch(e) {
//			console.log(e);
			return false;
		}
	}

	async remove(keyID) {
		try {
			console.log('\x1b[1m%s\x1b[0m', 'Node removed:', keyID, this.nodes[keyID].host + ':' + this.nodes[keyID].port);
			await this.DB.delete('nodes', keyID);
			delete this.nodes[keyID];
		} catch(e) {
//			console.log(e);
		}
	}

	async getInfo(address = { host: '127.0.0.1', port: 28262 }) {
		try {
			let options = {
				host: address.host,
				port: address.port,
				path: '/info',
				method: 'GET'
			};
			let pingStart = new Date().getTime();
			let req = await doRequest(options);
			let pingFinish = new Date().getTime();
			let ping = pingFinish - pingStart;
			if (req.statusCode == 200) {
				let res = await getResponse(req)
				let info = JSON.parse(res);
				info.ping = ping;
				return info;
			} else {
				return false;
			}
		} catch(e) {
//			console.log(e);
			return false;
		}
	}

	async getNodes(address = { host: '127.0.0.1', port: 28262 }) {
		try {
			let options = {
				host: address.host,
				port: address.port,
				path: '/getNodes',
				method: 'GET'
			};
			let req = await doRequest(options);
			if (req.statusCode == 200) {
				let res = await getResponse(req);
				let list = JSON.parse(res);
				let keys = Object.keys(list);
				for (let i = 0, l = keys.length; i < l; i++) {
					if (this.nodes[keys[i]] === undefined) {
						var node = await this.getInfo({
							host: list[keys[i]].host,
							port: list[keys[i]].port
						});
						if (node !== false) await this.checkNodeInDB(node);
					}
				}
			}
		} catch(e) {
//			console.log(e);
			return false;
		}
	}

	async sendMessage(address = { host: '127.0.0.1', port: 28262 }, message = {}) {
		try {
			let options = {
				host: address.host,
				port: address.port,
				path: '/',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': (JSON.stringify(message)).length
				}
			};
			await doRequest(options, JSON.stringify(message));
		} catch(e) {
//			console.log(e);
		}
	}

	async sendMessageToAll(message = {}) {
		try {
			let keys = Object.keys(this.nodes);
			for (let i = 0, l = keys.length; i < l; i++) {
				await this.sendMessage({ host: this.nodes[keys[i]].host, port: this.nodes[keys[i]].port }, message);
			}
		} catch(e) {
//			console.log(e);
		}
	}

	async sendHandshake(node = { host: '127.0.0.1', port: 28262 }) {
		try {
			console.log('Sending handshake to', node.host + ':' + node.port);
			let address = {	host: this.CONFIG.host, port: this.CONFIG.port };
			let encrypted = await this.PGP.encryptMessage(JSON.stringify(address), node.publicKey, true);
			await this.sendMessage(node, { handshake: encrypted });
		} catch(e) {
//			console.log(e);
		}
	}

	async checkNodeInDB(node) {
		if ((node) && (node.publicKey)) try {
			let key = await this.PGP.readKey(node.publicKey);
			if (key) {
				let keyID = key.getKeyID().toHex();
				if (this.nodes[keyID] !== undefined) {
					let publicKeyArmored = await this.DB.read('nodes', keyID);
					if (publicKeyArmored === node.publicKey) {
						this.nodes[keyID].ping = node.ping;
						this.sendHandshake(node);
					} else {
						await this.remove(keyID);
					}
				} else {
					await this.add({
						keyID: keyID,
						host: node.host,
						port: node.port,
						ping: node.ping,
						publicKey: node.publicKey
					});
					this.sendHandshake(node);
				}
			}
		} catch(e) {
//			console.log(e);
		}
	}

	async checkingNodes() {
		let keys = Object.keys(this.nodes);
		if (keys.length > 0) for (let i = 0, l = keys.length; i < l; i++) {
			try {
				var node = await this.getInfo({
					host: this.nodes[keys[i]].host,
					port: this.nodes[keys[i]].port
				});
				if (node !== false) {
					await this.checkNodeInDB(node);
				} else {
					await this.remove(keys[i]);
				}
			} catch(e) {
//				console.log(e);
			}
		}
	}

	async searchingNodes() {
		const nets = networkInterfaces();
		const results = {};
		for (const name of Object.keys(nets)) {
			for (const net of nets[name]) {
				// Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
				// 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
				const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
				if (net.family === familyV4Value && !net.internal) {
					if (!results[name]) {
						results[name] = [];
					}
					results[name].push(net.address);
					await this.pingAddresses(net.address);
				}
			}
		}
	}

	async pingAddresses(address) {
		let addr = address.split('.');
		let host, port;
		for (let i = 1, l = 255; i < l; i++) {
			try {
				host = addr[0] + '.' + addr[1] + '.' + addr[2] + '.' + i;
				port = '28262';
				var node = await this.getInfo({ host: host, port: port });
				if (node !== false) await this.checkNodeInDB(node);
			} catch(e) {
//				console.log(e);
			}
		}
	}

}

module.exports = nznode;
