$(function () {
    $.get(window.location.href + '/data', function (data) {
        var ctx = $('#questionnare_overall')[0].getContext('2d');
        pam_chart = new Chart(ctx,
            {
                type: 'line',
                data: {
                    datasets: [{
                        data: data.lists.data,
                        label: "PAM Score"
                    }],
                },
                options: {
                    scales: {
                        yAxes: [{
                            ticks: {
                                suggestedMin: 0,
                                suggestedMax: 52
                            }
                        }],
                        xAxes: [{
                            type: 'time',
                            time: {
                                unit: 'day',
                                unitStepSize: 1,
                                tooltipFormat: "h:mm:ss a",
                                displayFormats: {
                                    hour: 'MMM D, h:mm A'
                                }
                            }
                        }]
                    }
                }
            });

        data.questions.data.forEach(function (dataSet) {
            console.log(dataSet);
            ctx = $('#questionnare_per_question_' + dataSet.label)[0].getContext('2d')
            question_chart = new Chart(ctx,
                {
                    type: 'line',
                    data: {
                        datasets: [{
                            data: dataSet.data,
                            label: 'Vraag ' + dataSet.label
                        }]
                    },
                    options: {
                        scales: {
                            yAxes: [{
                                ticks: {
                                    suggestedMin: 0,
                                    suggestedMax: 5
                                }
                            }],
                            xAxes: [{
                                type: 'time',
                                time: {
                                    unit: 'second',
                                    round: 'second',
                                    stepSize: 1,
                                    tooltipFormat: "h:mm:ss a",
                                    displayFormats: {
                                        hour: 'MMM D, h:mm A'
                                    }
                                }
                            }]
                        }
                    }
                })
        });
        ctx = $('#blood')[0].getContext('2d')
        question_chart = new Chart(ctx,
            {
                type: 'line',
                data: {
                    datasets: [{
                        yAxisID: 'Pressure',
                        data: data.blood.systolic,
                        borderColor: "#3e95cd",
                        label: 'Systolisch',
                        fill: false
                    },
                    {
                        yAxisID: 'Pressure',
                        data: data.blood.diastolic,
                        borderColor: "#8e5ea2",
                        label: 'Diastolisch',
                        fill: false
                    },
                    {
                        yAxisID: 'Pulse',
                        data: data.blood.pulse,
                        borderColor: "#c45850",
                        label: 'Hartslag',
                        fill: false
                    }]
                },
                options: {
                    scales: {
                        yAxes: [{
                            id: 'Pressure',
                            type: 'linear',
                            ticks: {
                                suggestedMin: 40,
                                suggestedMax: 200
                            }
                        }, {
                            id: 'Pulse',
                            type: 'linear',
                            ticks: {
                                suggestedMin: 0,
                                suggestedMax: 125
                            }
                        }],
                        xAxes: [{
                            type: 'time',
                            time: {
                                tooltipFormat: "h:mm:ss a",
                                displayFormats: {
                                    hour: 'MMM D, h:mm A'
                                }
                            }
                        }]
                    }
                }
            })

        ctx = $('#weight')[0].getContext('2d')
        question_chart = new Chart(ctx,
            {
                type: 'line',
                data: {
                    datasets: [{
                        data: data.weight.data,
                        label: 'Gewicht'
                    }]
                },
                options: {
                    scales: {
                        yAxes: [{
                            type: 'linear'
                        }],
                        xAxes: [{
                            type: 'time',
                            time: {
                                tooltipFormat: "h:mm:ss a",
                                displayFormats: {
                                    hour: 'MMM D, h:mm A'
                                }
                            }
                        }]
                    }
                }
            })
    });
});