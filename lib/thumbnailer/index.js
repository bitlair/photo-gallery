'use strict';

const Promise = require("bluebird");
const gm = require("gm");
const fs = Promise.promisifyAll(require("fs"));
const path = require("path");

const ThumbnailError = require("./error");

function createReadStream(filePath) {
	return new Promise((resolve, reject) => {
		let readStream = fs.createReadStream(filePath);

		function openHandler() {
			detachHandlers();
			resolve(readStream);
		}

		function errorHandler(err) {
			detachHandlers();
			reject(err);
		}

		function detachHandlers() {
			readStream.removeListener("open", openHandler);
			readStream.removeListener("error", errorHandler);
		}

		readStream.on("open", openHandler);
		readStream.on("error", errorHandler);
	});
}

module.exports = function createThumbnailer(thumbnailFolder, pictureFolder, {width, height, quality}) {
	return async function getThumbnail(date, filename) {
		let thumbnailPath = path.join(thumbnailFolder, date, filename);

		try {
			return await createReadStream(thumbnailPath);
		} catch (err) {
			if (err.code != 'ENOENT') {
				throw err
			}
		}

		/* Thumbnail does not exist yet, we need to create one. */

		try {
			await fs.mkdirAsync(path.join(thumbnailFolder, date));
		} catch (err) {
			/* Ignore this type of error, it just means that the destination folder already exists. */
			if (err.code != 'EEXIST') {
				throw err
			}
		}

		let resizer = gm(path.join(pictureFolder, date, filename)).
			noProfile().
			resize(width, height).
			quality(quality);
		Promise.promisifyAll(resizer); // HACK
		await resizer.writeAsync(thumbnailPath);

		return await createReadStream(thumbnailPath);
	};
};
