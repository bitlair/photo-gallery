'use strict';

const Promise = require("bluebird");
const gm = require("gm");
const fs = Promise.promisifyAll(require("fs"));
const path = require("path");
const ffmpeg = require('fluent-ffmpeg');

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

module.exports = function createThumbnailer(thumbnailFolder, pictureFolder, conf) {
	return async function getThumbnail(date, filename) {
		let thumbnailPath = path.join(thumbnailFolder, date, filename.replace(/\..+$/, '.jpg'));
		let filePath = path.join(pictureFolder, date, filename);

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

		// file kind check duplicated with lib/photo-manager/index.js
		if (filename.match(/\.(jpg|png)$/i)) {
			await createImageThumbnail(filePath, thumbnailPath, conf);
		} else if (filename.match(/\.(mp4|webm|mov)$/i)) {
			await createVideoThumbnail(filePath, thumbnailPath, conf);
		} else {
			throw new ThumbnailError('not sure how to make a thumbnail for this file');
		}

		return await createReadStream(thumbnailPath);
	};
};

async function createImageThumbnail(inPath, outPath, {width, height, quality}) {
	let resizer = gm(inPath)
		.noProfile()
		.resize(width, height)
		.quality(quality);
	Promise.promisifyAll(resizer); // HACK
	await resizer.writeAsync(outPath);
}

function createVideoThumbnail(inPath, outPath, {width, height, quality}) {
	return (new Promise((resolve, reject) => {
		ffmpeg(inPath).ffprobe((err, metadata) => {
			if (err) reject(err)
			else resolve(metadata);
		});
	}))
		.then((metadata) => {
			let offset = metadata.format.duration * 0.9;
			return new Promise((resolve, reject) => {
				ffmpeg(inPath)
					.output(outPath)
					.noAudio()
					.seek(offset)
					.on('error', reject)
					.on('end', resolve)
					.run();
			})
		});
}
