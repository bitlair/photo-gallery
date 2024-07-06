'use strict';

const express = require("express");
const expressPromiseRouter = require("express-promise-router");
const path = require("path");
const defaultValue = require("default-value");
const unhandledError = require("unhandled-error");

const config = require("./config.json");
const createThumbnailer = require("./lib/thumbnailer");
const createPhotoManager = require("./lib/photo-manager");
const validatePhotoFilename = require("./lib/validate/photo-filename");
const validateDateFolderName = require("./lib/validate/date-folder");
const validateNumber = require("./lib/validate/number");
const ValidationError = require("./lib/validate/error");
const ThumbnailError = require("./lib/thumbnailer/error");

let errorHandler = unhandledError((err, context) => {
	console.log("Unhandled error!", err);
});

let thumbnailer = createThumbnailer(path.join(__dirname, "thumbnails"), config.pictureFolder, {width: config.thumbnails.width, height: config.thumbnails.height, quality: config.thumbnails.quality});

let photoManager = createPhotoManager({
	photoPath: config.pictureFolder,
	paginationThreshold: config.paginationThreshold
});

let app = express();

app.locals.pathPrefix = config.pathPrefix;

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

// NOTE: This means that any proxied IP header is trusted! While the client IP is not currently used anywhere, this means that anyone who can connect to the service directly can spoof their IP.
app.set("trust proxy", true);

app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(config.pictureFolder));

let router = expressPromiseRouter();

router.get("/latest", async (req, res) => {
	if (req.query.amount != null) {
		validateNumber(req.query.amount);
	}

	let pictures = await photoManager.getPictures();

	let amount = parseInt(defaultValue(req.query.amount, 3));

	res.json({
		latest: pictures.slice(0, amount).map((picture) => {
			return {
				date: picture.date.momentDate.format("YYYY-MM-DD"),
				filename: picture.filename,
				url: `${config.pathPrefix}/view/${picture.date.date}/${picture.filename}`,
				thumbnail: `${config.pathPrefix}/thumbnails/${picture.date.date}/${picture.filename}`
			};
		})
	});
});

router.get("/:page?", async (req, res) => {
	if (req.params.page != null) {
		validateNumber(req.params.page);
	}

	let dates = await photoManager.getPaginatedDatesWithPictures();
	let pageParam = defaultValue(req.params.page, 1);
	let pageNumber = parseInt(pageParam) - 1;

	if (pageNumber < 0 || pageNumber > dates.length - 1) {
		res.status(404).send("404 not found");
		return;
	}

	res.render("index", {
		dates: dates[pageNumber],
		currentPage: pageNumber + 1,
		totalPages: dates.length
	});
});

router.get("/view/:date/:filename", async (req, res) => {
	validateDateFolderName(req.params.date);
	validatePhotoFilename(req.params.filename);

	let photo = await photoManager.getPicture(req.params.date, req.params.filename);
	if (photo == null) {
		res.status(404).send("404 not found");
		return;
	}

	res.render("view", {
		photo: photo,
		previousPhoto: photo.previous,
		nextPhoto: photo.next,
		// NOTE: The below does not currently work when the user-facing HTTPd is running on a non-standard port!
		absoluteThumbnail: `${req.protocol}://${req.host}${config.pathPrefix}/thumbnails/${photo.date.date}/${photo.filename}`,
	});
});

router.get("/thumbnails/:date/:filename", async (req, res) => {
	validateDateFolderName(req.params.date);
	validatePhotoFilename(req.params.filename);

	try {
		let stream = await thumbnailer(req.params.date, req.params.filename);
		stream.pipe(res);
	} catch (err) {
		if (/Unable to open file/.test(err.message)) {
			res.status(404).send("404 not found");
		} else {
			throw err;
		}
	}
});

app.use(router);

app.use((err, req, res, next) => {
	if (err instanceof ValidationError) {
		res.status(404).send("404 not found");
	} else if (err instanceof ThumbnailError) {
		res.status(500).send("Failed to generate thumbnail - not an image file?");
	} else {
		errorHandler.report(err, {
			req: req,
			res: res
		});
	}
});

app.listen(config.listen.port, () => {
	console.log(`Server listening on port ${config.listen.port}...`);
});
