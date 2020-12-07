const cheerio = require('cheerio')
const axios = require('axios')
const FormData = require('form-data');
const fs = require('fs')


class Parser {
    state = {
        parseSettings: [
            { category: "housing" ,url: "http://jerdesh.ru/birge_sdayu_komnatu_kojko_mesto", howManyPagesParse: 10},
            { category: "job", url: "http://jerdesh.ru/birge_rabota/jumush_ish", howManyPagesParse: 10},
        ],
        separator: "&@%"
    }

    async asyncForEach(arrOrNum, callback) {
        const isArray = typeof arrOrNum !== "number"
        const maxIterValue = isArray ? arrOrNum.length : arrOrNum
        for(let i = 0; i < maxIterValue; i++) {
           const result = isArray ? await callback(arrOrNum[i], i, arrOrNum) : await callback(i)
            if(result === false) break;
        }
    }

    promise(resolveCallback) {
        return new Promise((resolve, reject) => {
            this.setTimeout(() => {
                console.log("ANOTHER ONE TRY MAKE REQUEST")
                resolve(resolveCallback())
            })
        })
    }

    setTimeout(callback) {
       return setTimeout(callback, 10000)
    }

    writeFileSync(fileName, data = "") {
        fs.writeFileSync(`${fileName}.csv`, data, "utf8")
    }

    prepareAnnouncementsForAppendFile(announcements) {
        const flatAnnouncements = announcements.flat()
        return flatAnnouncements.map(announcement => this.objToString(announcement) ).join("\n")
    }

    objToString({link, ...restAnnouncement}) {
       return Object.values(restAnnouncement).join(this.state.separator)
    }

    async getHTML(url) {
        try {
            const {data} = await axios.get(url)
            return cheerio.load(data)
        } catch (err) {
            console.log("ERROR WHEN GET HTML")
            this.writeErrorFile(`${err} THIS ERROR WAS HAPPEN WHEN GET HTML`)
            return this.promise(() => this.getHTML(url))

        }

    }
    prepareCreationDate(creationDate) {
        const date = new Date()
        const currYear = date.getFullYear();
        const currMonth = date.getMonth() + 1;
        const currDay = date.getDate();

        const months = [
            "Январь", "Февраль", "Март", "Апрель",
            "Май", "Июнь", "Июль", "Август",
            "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
        ]
        const getMonthNumber = (month) => {
            const monthNumber = months.indexOf(month) + 1
            return monthNumber > 1 ? monthNumber : `0${monthNumber}`
        }

        const [monthOrDay, day, year] = creationDate.split(",").map(el => el.trim().split(" ")).flat()

        switch (monthOrDay) {
            case "Сегодня" :
                return `${currDay}.${currMonth}.${currYear}`
            case "Вчера" :
                date.setDate(date.getDate() - 1)
                return `${currDay}.${currMonth}.${currYear}`
            default :
                return `${day}.${getMonthNumber(monthOrDay)}.${year}`
        }

    }

    prepareCategory(category) {
        switch (category) {
            case "Квартира берилет" :
                return "apartments"
            case "Комната берем" :
                return "room"
            case "Квартирант алам" :
                return "bed"
            case "Жумуш/ Иш берилет" :
                return "vacancies"
            default :
                return null
        }
    }

   async sendParsedData() {
        console.log(`SEND result.csv FILE`)
        const form = new FormData
        form.append("file", fs.createReadStream("./result.csv"))
       try {
           await axios.post('https://salamkg.ru/admin/upload', form, {
               headers: form.getHeaders(),
               auth: {
                   username: 'IvanAdmin',
                   password: 'IvanAdmin'
               }
           })
           console.log("PARSED DATA WAS SEND!")
           return true
       } catch (err) {
           console.log("ERROR SEND PARSED DATA!")
           this.writeErrorFile(`${err} THIS ERROR WAS HAPPEN WHEN SEND PARSED DATA`)
           return this.promise(() => this.sendParsedData())
       }


    }

    getLastAnnouncementLink(category) {
        try {
            const resultRead = fs.readFileSync(`${category}LastLink.csv`, "utf-8")
            const [link] = resultRead.split(this.state.separator);
            return link
        } catch (err) {
            return null
        }

    }

    writeErrorFile(data) {
        fs.writeFileSync("errorsLog.txt", data, "utf-8")
    }

    async parse(html, lastAnnouncementLink) {
        try {
            const announcements = []
            let result = {announcements, isLast: false}
            html("ul.premium-list").remove()
            const announcementsList = html(".listing-card", "ul.listing-card-list")
            const announcementsHTML = Object.values(announcementsList)
            await this.asyncForEach(announcementsHTML, async (element, iter) => {
                const announcementSubInfoDiv = html(element).find("div.listing-attributes").text().replace(/\n/g, '').split(" -")
                const category = announcementSubInfoDiv[0].trim()
                const linkElement = html(element).find("a.title")
                const link = linkElement.attr("href")
                if(lastAnnouncementLink === link) {
                    console.log("FIND LAST ANNOUNCEMENT!")
                    result = {...result, isLast: true}
                    return false
                }
                if (this.prepareCategory(category) !== null) {
                    const name = linkElement.text().replace(/\n/g, '').replace(/\s/g, ' ').trim()
                    const announcementPage = await this.getHTML(link)
                    const description = announcementPage("p", "#description").text().replace(/\n/g, '').replace(/\s/g, ' ').replace("Связаться с автором", "").trim()
                    const photo = html(element).find("img").attr("src")
                    const price = 0
                    const sellerPhone = html(element).find("span.protectedNumber").attr("title").trimEnd()
                    const divParent = html(element).find("div.listing-basicinfo").text().replace(/\n/g, '').replace(/\s+/g, ',').split(",")
                    const sellerName = divParent[divParent.length - 3]
                    const station = announcementSubInfoDiv[1].trim().replace(/[()]/g, "") || "Алексеевская"
                    const creationDate = announcementSubInfoDiv[2].trim()
                    const announcement = {
                        link,
                        name,
                        price,
                        category: this.prepareCategory(category),
                        description,
                        sellerPhone,
                        sellerName,
                        station,
                        creationDate: this.prepareCreationDate(creationDate),
                        photo: photo === "http://jerdesh.ru/metropic/_.png" ? "" : photo,
                        addedByUser: false,
                    }
                    this.prepareCategory(category) !== null && name.length < 50 && announcements.push(announcement)
                }
            })
            return result
        } catch (e) {
            console.log(e)
        }
    }

   async start() {
       console.log(`START`)
       const { parseSettings } = this.state
       const announcements = []
       await this.asyncForEach(parseSettings, async (parseSetting) => {
            const {category, url, howManyPagesParse} = parseSetting
           console.log(`START PARSING ${category} CATEGORY`)
            const lastAnnouncementLink = this.getLastAnnouncementLink(category)
            await this.asyncForEach(howManyPagesParse, async (iter) => {
                const pageNum = iter + 1
                console.log(`PARSE ${url}/${pageNum}`)
                const html = await this.getHTML(`${url}/${pageNum}`)
                const {announcements:announcementsByPage, isLast} = await this.parse(html, lastAnnouncementLink)
                if(isLast) return false
                announcements.push(announcementsByPage)
                if(iter === 0 && announcementsByPage.length) {
                    console.log(`WRITE ${category}LastLink.csv`)
                    const values = Object.values(announcementsByPage[0])
                    const preparedForWriteLastLink = values.join(this.state.separator)
                    this.writeFileSync(`${category}LastLink`, preparedForWriteLastLink)
                }
                console.log(`IN ${pageNum} PAGE WAS FIND ${announcementsByPage.length} ANNOUNCEMENTS`)
            })
                console.log(`FINISH PARSE ${category} CATEGORY`)
        } )
       if(announcements.length) {
           console.log(`WRITE result.csv FILE`)
           const preparedForAppendAnnouncements = this.prepareAnnouncementsForAppendFile(announcements)
           this.writeFileSync("result", preparedForAppendAnnouncements)
           // this.sendParsedData()
       } else {
           this.writeFileSync("result", "")
           console.log(`NEW ANNOUNCEMENTS IN ALL CATEGORIES IS NOT FIND`)
       }
    }
}
const parser = new Parser
parser.start()
setInterval(() => {
    console.log("START INTERVAL 30 MIN")
    parser.start()
}, 1800000)
